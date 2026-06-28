# Admin 1С Sync Control Center (v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать admin-оператору рычаги управления уже работающей 1С-синхронизацией (ручной запуск, bulk-retry DLQ, пауза/резюм крона, перемотка курсора), расширив `/admin/sync` из read-only в control center.

**Architecture:** Подход 1 из спеки — тонкий пульт над существующими очередями. Логика в `services/admin/syncControl.ts` (Result-тип §3, инъектируемый queue-провайдер). Мутации trigger/pause/cursor — server-actions (`requireRole` redirect-guard); bulk-retry — sibling API-роут (`guard` response-guard). Пауза персистентна (`SyncSchedulePause`), переживает рестарт воркера. Полный дизайн: [spec](../specs/2026-06-07-admin-sync-control-center-design.md).

**Tech Stack:** Next.js 15 (App Router, server components + server-actions), TypeScript strict, Prisma 5 + PostgreSQL, BullMQ + Redis, Vitest (`environment: 'node'`, classic JSX transform — `import React` обязателен в компонент-тестах).

**Соглашения для исполнителя:**
- Каждый `git commit` заканчивается trailer'ом `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (передавай вторым `-m`).
- Pre-commit hook (§6 L1) на каждом коммите гоняет `lint-staged → typecheck → test:changed`. Коммит = весь проект типизируется и затронутые тесты зелёные. **Поэтому порядок задач важен:** миграция+`prisma generate` (Task 2) до любого кода, читающего `prisma.syncSchedulePause`.
- Команды vitest: один файл — `npx vitest run <path> --mode=unit`.
- Работаем на ветке `claude/admin-sync-control-spec` (spec уже там, коммит `03f3281`).

---

## File Structure

**Создаём:**
- `src/lib/services/admin/syncControl.ts` — `SYNC_ENTITIES`, провайдер, `triggerSync`, `setSchedulePaused`, `rewindCursor` (Result-тип, audit внутри).
- `src/server-actions/admin/syncControl.ts` — `triggerSyncAction`, `setSchedulePausedAction`, `rewindCursorAction` (zod + `requireAdmin` + revalidate).
- `src/app/api/admin/dlq/[queue]/retry-all/route.ts` — bulk-retry POST (guard-style + audit).
- `src/components/admin/sync-trigger-button.tsx`, `sync-schedule-toggle.tsx`, `sync-cursor-dialog.tsx`, `retry-all-button.tsx` — клиентские обёртки.
- Тесты: `src/__tests__/services.admin.syncControl.test.ts`, `server-actions.admin.syncControl.test.ts`, `api.admin.dlq.retry-all.test.ts`, `components.sync-cursor-dialog.test.ts`, `services.admin.syncControl.integration.test.ts`.

**Модифицируем:**
- `src/lib/auth/audit.ts` — `AuditEntity` += `'sync_state' | 'sync_schedule' | 'job_queue'`.
- `prisma/schema.prisma` — `model SyncSchedulePause` (+ миграция).
- `src/lib/services/admin/queueStats.ts` — `retryAllDlq()`.
- `src/lib/jobs/scheduling.ts` — `registerSyncSchedules(getQueueFn, pausedSchedulerIds?)` + `loadPausedSchedulerIds()`.
- `src/worker/index.ts` — читает paused-set, прокидывает в `registerSyncSchedules`.
- `src/app/admin/sync/page.tsx` — read-only → control center.
- `src/app/admin/health/page.tsx` — bulk-retry рядом с DLQ.
- Тесты: `src/__tests__/services.admin.queueStats.test.ts`, `jobs.scheduling.test.ts`, `recordAudit.test.ts` (расширяем).

---

## Task 1: Расширить `AuditEntity` union

**Files:**
- Modify: `src/lib/auth/audit.ts:3-17`
- Test: `src/__tests__/recordAudit.test.ts`

- [ ] **Step 1: Add a failing test case for the new entity**

В `src/__tests__/recordAudit.test.ts` добавь тест (внутри существующего `describe`):

```ts
it('persists the new sync-control entities', async () => {
  const create = vi.fn().mockResolvedValue({});
  const prisma = { auditLog: { create } } as unknown as import('@prisma/client').PrismaClient;
  await recordAudit(prisma, {
    userId: 'u1',
    action: 'sync_triggered',
    entity: 'sync_state',
    entityId: 'order',
  });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ entity: 'sync_state' }) })
  );
});
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run typecheck`
Expected: FAIL — `Type '"sync_state"' is not assignable to type 'AuditEntity'`.

- [ ] **Step 3: Extend the union**

В `src/lib/auth/audit.ts` замени блок union на:

```ts
export type AuditEntity =
  | 'user'
  | 'partner'
  | 'organization'
  | 'organization_user'
  | 'organization_manager'
  | 'order'
  | 'commission_statement'
  | 'lead'
  | 'lead_attachment'
  | 'document'
  | 'partner_user'
  | 'student_bridge'
  | 'order_thread'
  | 'company'
  | 'sync_state'
  | 'sync_schedule'
  | 'job_queue';
```

- [ ] **Step 4: Run typecheck + the test**

Run: `npm run typecheck && npx vitest run src/__tests__/recordAudit.test.ts --mode=unit`
Expected: typecheck 0 errors; test file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/audit.ts src/__tests__/recordAudit.test.ts
git commit -m "feat(audit): add sync_state/sync_schedule/job_queue entities" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `SyncSchedulePause` модель + миграция

**Files:**
- Modify: `prisma/schema.prisma` (добавить модель рядом с `SyncState`, ~строка 302)
- Create: `prisma/migrations/<ts>_sync_schedule_pause/migration.sql` (генерируется)

- [ ] **Step 1: Add the model**

После блока `model SyncState { ... }` в `prisma/schema.prisma` добавь:

```prisma
model SyncSchedulePause {
  schedulerId String   @id
  pausedAt    DateTime @default(now())
  pausedBy    String
}
```

- [ ] **Step 2: Create migration + regenerate client**

Run: `npx prisma migrate dev --name sync_schedule_pause`
Expected: новая папка `prisma/migrations/<ts>_sync_schedule_pause/` с `CREATE TABLE "SyncSchedulePause"`, клиент перегенерирован.

(Требует живой Postgres на :5432 — по [project-running-locally] host-БД `cabinet` уже слушает.)

- [ ] **Step 3: Verify client typing**

Run: `npm run typecheck`
Expected: 0 errors (доступен `prisma.syncSchedulePause`).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): SyncSchedulePause model (presence=paused)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `syncControl.ts` foundations + `rewindCursor`

**Files:**
- Create: `src/lib/services/admin/syncControl.ts`
- Test: `src/__tests__/services.admin.syncControl.test.ts`

- [ ] **Step 1: Write failing tests for rewindCursor**

Создай `src/__tests__/services.admin.syncControl.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { rewindCursor } from '@/lib/services/admin/syncControl';

function txPrisma(existingCursor: string | null) {
  const findUnique = vi.fn().mockResolvedValue(existingCursor === undefined ? null : { cursor: existingCursor });
  const upsert = vi.fn().mockResolvedValue({});
  const create = vi.fn().mockResolvedValue({});
  const tx = { syncState: { findUnique, upsert }, auditLog: { create } };
  const prisma = { $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
  return { prisma: prisma as never, findUnique, upsert, create };
}

describe('rewindCursor', () => {
  it('rejects an unknown entity', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'nope', null)).toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('rejects reconcile (no cursor)', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'reconcile', '2026-06-01T00:00:00.000Z'))
      .toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('rejects a future timestamp', async () => {
    const { prisma } = txPrisma(null);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(await rewindCursor(prisma, 'u1', 'order', future)).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('rejects an unparseable timestamp', async () => {
    const { prisma } = txPrisma(null);
    expect(await rewindCursor(prisma, 'u1', 'order', 'not-a-date')).toEqual({ ok: false, error: 'invalid_cursor' });
  });

  it('upserts cursor and writes before/after audit atomically', async () => {
    const { prisma, upsert, create } = txPrisma('2026-06-05T00:00:00.000Z');
    const res = await rewindCursor(prisma, 'u1', 'order', '2026-06-01T00:00:00.000Z');
    expect(res).toEqual({ ok: true, entity: 'order', cursor: '2026-06-01T00:00:00.000Z' });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { entity: 'order' },
      update: { cursor: '2026-06-01T00:00:00.000Z' },
    }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        entity: 'sync_state',
        entityId: 'order',
        meta: expect.objectContaining({
          before: { cursor: '2026-06-05T00:00:00.000Z' },
          after: { cursor: '2026-06-01T00:00:00.000Z' },
        }),
      }),
    }));
  });

  it('accepts null (full reset)', async () => {
    const { prisma, upsert } = txPrisma('2026-06-05T00:00:00.000Z');
    const res = await rewindCursor(prisma, 'u1', 'document', null);
    expect(res).toEqual({ ok: true, entity: 'document', cursor: null });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { cursor: null } }));
  });

  it('returns storage on transaction failure', async () => {
    const prisma = { $transaction: vi.fn().mockRejectedValue(new Error('db down')) } as never;
    expect(await rewindCursor(prisma, 'u1', 'order', null)).toEqual({ ok: false, error: 'storage' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit`
Expected: FAIL — cannot find module `syncControl` / `rewindCursor` is not a function.

- [ ] **Step 3: Implement foundations + rewindCursor**

Создай `src/lib/services/admin/syncControl.ts`:

```ts
import type { Queue } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { getQueue, type QueueName } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';

export type SyncControlEntity = 'organization' | 'order' | 'payment' | 'document' | 'reconcile';

export const SYNC_ENTITIES: Record<
  SyncControlEntity,
  { queueName: QueueName; schedulerId: string; hasCursor: boolean }
> = {
  organization: { queueName: 'oneCSync.pullOrganizations', schedulerId: 'oneCSync.pullOrganizations.cron', hasCursor: true },
  order: { queueName: 'oneCSync.pullOrders', schedulerId: 'oneCSync.pullOrders.cron', hasCursor: true },
  payment: { queueName: 'oneCSync.pullPayments', schedulerId: 'oneCSync.pullPayments.cron', hasCursor: true },
  document: { queueName: 'oneCSync.pullDocuments', schedulerId: 'oneCSync.pullDocuments.cron', hasCursor: true },
  reconcile: { queueName: 'oneCSync.reconcile', schedulerId: 'oneCSync.reconcile.cron', hasCursor: false },
};

function isSyncControlEntity(x: string): x is SyncControlEntity {
  return Object.prototype.hasOwnProperty.call(SYNC_ENTITIES, x);
}

/** Injection seam: trigger needs add/getJobCounts, pause needs scheduler ops. */
export type SyncControlQueueProvider = (
  name: QueueName,
) => Pick<Queue, 'getJobCounts' | 'add' | 'upsertJobScheduler' | 'removeJobScheduler'>;

export const defaultSyncProvider: SyncControlQueueProvider = (name) => getQueue(name);

export type RewindResult =
  | { ok: true; entity: SyncControlEntity; cursor: string | null }
  | { ok: false; error: 'unknown_entity' | 'invalid_cursor' | 'storage' };

export async function rewindCursor(
  prisma: PrismaClient,
  actorUserId: string,
  entity: string,
  cursorIso: string | null,
): Promise<RewindResult> {
  if (!isSyncControlEntity(entity) || !SYNC_ENTITIES[entity].hasCursor) {
    return { ok: false, error: 'unknown_entity' };
  }
  if (cursorIso !== null) {
    const ts = Date.parse(cursorIso);
    if (Number.isNaN(ts) || ts > Date.now()) return { ok: false, error: 'invalid_cursor' };
  }
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.syncState.findUnique({ where: { entity }, select: { cursor: true } });
      const before = existing?.cursor ?? null;
      await tx.syncState.upsert({
        where: { entity },
        update: { cursor: cursorIso },
        create: { entity, cursor: cursorIso },
      });
      await recordAudit(tx, {
        userId: actorUserId,
        action: 'cursor_rewound',
        entity: 'sync_state',
        entityId: entity,
        before: { cursor: before },
        after: { cursor: cursorIso },
      });
    });
    return { ok: true, entity, cursor: cursorIso };
  } catch {
    return { ok: false, error: 'storage' };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit && npm run typecheck`
Expected: PASS (7 tests); typecheck 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/admin/syncControl.ts src/__tests__/services.admin.syncControl.test.ts
git commit -m "feat(sync-control): SYNC_ENTITIES map + rewindCursor service" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `triggerSync`

**Files:**
- Modify: `src/lib/services/admin/syncControl.ts`
- Test: `src/__tests__/services.admin.syncControl.test.ts`

- [ ] **Step 1: Add failing tests**

Добавь в `src/__tests__/services.admin.syncControl.test.ts`:

```ts
import { triggerSync, type SyncControlQueueProvider } from '@/lib/services/admin/syncControl';

function auditPrisma() {
  const create = vi.fn().mockResolvedValue({});
  return { prisma: { auditLog: { create } } as never, create };
}

describe('triggerSync', () => {
  it('rejects an unknown entity', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
    expect(await triggerSync(prisma, 'u1', 'nope', provider)).toEqual({ ok: false, error: 'unknown_entity' });
  });

  it('refuses when a run is already active', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 1 }),
      add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    expect(await triggerSync(prisma, 'u1', 'order', provider)).toEqual({ ok: false, error: 'already_running' });
  });

  it('enqueues a manual job and audits on success', async () => {
    const { prisma, create } = auditPrisma();
    const add = vi.fn().mockResolvedValue({ id: 'j1' });
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockResolvedValue({ active: 0 }),
      add, upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    const res = await triggerSync(prisma, 'u1', 'order', provider);
    expect(res.ok).toBe(true);
    expect(add).toHaveBeenCalledWith('manual', expect.objectContaining({ reason: 'manual' }), expect.objectContaining({ jobId: expect.stringMatching(/^manual:order:\d+$/) }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: 'sync_state', action: 'sync_triggered' }) }));
  });

  it('returns queue_unavailable when the queue throws', async () => {
    const { prisma } = auditPrisma();
    const provider: SyncControlQueueProvider = () => ({
      getJobCounts: vi.fn().mockRejectedValue(new Error('redis down')),
      add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn(),
    }) as never;
    expect(await triggerSync(prisma, 'u1', 'order', provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit`
Expected: FAIL — `triggerSync` is not a function.

- [ ] **Step 3: Implement triggerSync**

Добавь в `src/lib/services/admin/syncControl.ts` (после `rewindCursor`):

```ts
import type { SyncJobPayload } from '@/lib/jobs/types';

export type TriggerResult =
  | { ok: true; jobId: string }
  | { ok: false; error: 'already_running' | 'queue_unavailable' | 'unknown_entity' };

export async function triggerSync(
  prisma: PrismaClient,
  actorUserId: string,
  entity: string,
  provider: SyncControlQueueProvider = defaultSyncProvider,
): Promise<TriggerResult> {
  if (!isSyncControlEntity(entity)) return { ok: false, error: 'unknown_entity' };
  const { queueName } = SYNC_ENTITIES[entity];
  let jobId: string;
  try {
    const queue = provider(queueName);
    const counts = (await queue.getJobCounts('active')) as { active?: number };
    if ((counts.active ?? 0) > 0) return { ok: false, error: 'already_running' };
    jobId = `manual:${entity}:${Date.now()}`;
    const payload: SyncJobPayload = { triggeredAt: new Date().toISOString(), reason: 'manual' };
    await queue.add('manual', payload, { jobId });
  } catch {
    return { ok: false, error: 'queue_unavailable' };
  }
  // Audit is a secondary effect — never fail the enqueue over it (§3 graceful degrade).
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'sync_triggered',
    entity: 'sync_state',
    entityId: entity,
    after: { jobId, queue: queueName },
  }).catch((e) => console.warn('[syncControl] trigger audit failed', e));
  return { ok: true, jobId };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit && npm run typecheck`
Expected: PASS (11 tests total); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/admin/syncControl.ts src/__tests__/services.admin.syncControl.test.ts
git commit -m "feat(sync-control): triggerSync (manual enqueue + dedup)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `setSchedulePaused`

**Files:**
- Modify: `src/lib/services/admin/syncControl.ts`
- Test: `src/__tests__/services.admin.syncControl.test.ts`

- [ ] **Step 1: Add failing tests**

Добавь в `src/__tests__/services.admin.syncControl.test.ts`:

```ts
import { setSchedulePaused } from '@/lib/services/admin/syncControl';

function pausePrisma() {
  const upsert = vi.fn().mockResolvedValue({});
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const create = vi.fn().mockResolvedValue({});
  const prisma = { syncSchedulePause: { upsert, deleteMany }, auditLog: { create } } as never;
  return { prisma, upsert, deleteMany, create };
}

describe('setSchedulePaused', () => {
  it('rejects an unknown schedulerId', async () => {
    const { prisma } = pausePrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn() }) as never;
    expect(await setSchedulePaused(prisma, 'u1', 'bogus.cron', true, provider)).toEqual({ ok: false, error: 'unknown_schedule' });
  });

  it('pause: writes DB row then removes the live scheduler', async () => {
    const { prisma, upsert } = pausePrisma();
    const removeJobScheduler = vi.fn().mockResolvedValue(true);
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler }) as never;
    const res = await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', true, provider);
    expect(res).toEqual({ ok: true, paused: true });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { schedulerId: 'oneCSync.pullOrders.cron' } }));
    expect(removeJobScheduler).toHaveBeenCalledWith('oneCSync.pullOrders.cron');
  });

  it('resume: deletes DB row then re-registers the scheduler', async () => {
    const { prisma, deleteMany } = pausePrisma();
    const upsertJobScheduler = vi.fn().mockResolvedValue({ id: 'x' });
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler, removeJobScheduler: vi.fn() }) as never;
    const res = await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', false, provider);
    expect(res).toEqual({ ok: true, paused: false });
    expect(deleteMany).toHaveBeenCalledWith({ where: { schedulerId: 'oneCSync.pullOrders.cron' } });
    expect(upsertJobScheduler).toHaveBeenCalledWith('oneCSync.pullOrders.cron', expect.objectContaining({ tz: 'Europe/Moscow' }), expect.anything());
  });

  it('returns queue_unavailable when the scheduler op throws (DB intent kept)', async () => {
    const { prisma } = pausePrisma();
    const provider: SyncControlQueueProvider = () => ({ getJobCounts: vi.fn(), add: vi.fn(), upsertJobScheduler: vi.fn(), removeJobScheduler: vi.fn().mockRejectedValue(new Error('redis down')) }) as never;
    expect(await setSchedulePaused(prisma, 'u1', 'oneCSync.pullOrders.cron', true, provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit`
Expected: FAIL — `setSchedulePaused` is not a function.

- [ ] **Step 3: Implement setSchedulePaused**

Добавь в `src/lib/services/admin/syncControl.ts`:

```ts
import { SYNC_SCHEDULES } from '@/lib/jobs/scheduling';

export type PauseResult =
  | { ok: true; paused: boolean }
  | { ok: false; error: 'queue_unavailable' | 'unknown_schedule' };

export async function setSchedulePaused(
  prisma: PrismaClient,
  actorUserId: string,
  schedulerId: string,
  paused: boolean,
  provider: SyncControlQueueProvider = defaultSyncProvider,
): Promise<PauseResult> {
  const schedule = SYNC_SCHEDULES.find((s) => s.schedulerId === schedulerId);
  if (!schedule) return { ok: false, error: 'unknown_schedule' };

  // DB is the source of truth (worker reconciles on next register) — write it first.
  if (paused) {
    await prisma.syncSchedulePause.upsert({
      where: { schedulerId },
      update: { pausedBy: actorUserId, pausedAt: new Date() },
      create: { schedulerId, pausedBy: actorUserId },
    });
  } else {
    await prisma.syncSchedulePause.deleteMany({ where: { schedulerId } });
  }

  // Apply to the live Redis scheduler immediately.
  try {
    const queue = provider(schedule.queueName);
    if (paused) {
      await queue.removeJobScheduler(schedulerId);
    } else {
      await queue.upsertJobScheduler(
        schedulerId,
        { pattern: schedule.pattern, tz: schedule.tz },
        { data: { triggeredAt: new Date().toISOString(), reason: 'cron' } },
      );
    }
  } catch {
    // DB already reflects intent; surface so the operator can retry.
    return { ok: false, error: 'queue_unavailable' };
  }

  await recordAudit(prisma, {
    userId: actorUserId,
    action: paused ? 'sync_schedule_paused' : 'sync_schedule_resumed',
    entity: 'sync_schedule',
    entityId: schedulerId,
  }).catch((e) => console.warn('[syncControl] pause audit failed', e));
  return { ok: true, paused };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/services.admin.syncControl.test.ts --mode=unit && npm run typecheck`
Expected: PASS (15 tests total); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/admin/syncControl.ts src/__tests__/services.admin.syncControl.test.ts
git commit -m "feat(sync-control): setSchedulePaused (persistent pause + Redis)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `retryAllDlq` в `queueStats.ts`

**Files:**
- Modify: `src/lib/services/admin/queueStats.ts`
- Test: `src/__tests__/services.admin.queueStats.test.ts`

- [ ] **Step 1: Add failing tests**

Добавь в `src/__tests__/services.admin.queueStats.test.ts`:

```ts
import { retryAllDlq } from '@/lib/services/admin/queueStats';

describe('retryAllDlq', () => {
  it('retries every failed job and counts successes/failures', async () => {
    const okJob = { retry: vi.fn().mockResolvedValue(undefined) };
    const badJob = { retry: vi.fn().mockRejectedValue(new Error('not failed')) };
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockResolvedValue([okJob, okJob, badJob]),
      getJob: vi.fn(),
    } as any);
    const res = await retryAllDlq('docs.scanDocument', provider);
    expect(res).toEqual({ ok: true, retried: 2, failed: 1, truncated: false });
  });

  it('flags truncated when the failed page is full (>= cap)', async () => {
    const job = { retry: vi.fn().mockResolvedValue(undefined) };
    const full = Array.from({ length: 500 }, () => job);
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockResolvedValue(full),
      getJob: vi.fn(),
    } as any);
    const res = await retryAllDlq('docs.scanDocument', provider);
    expect(res).toEqual({ ok: true, retried: 500, failed: 0, truncated: true });
  });

  it('returns queue_unavailable when getFailed throws', async () => {
    const provider: QueueProvider = () => ({
      getJobCounts: vi.fn(),
      getFailed: vi.fn().mockRejectedValue(new Error('redis down')),
      getJob: vi.fn(),
    } as any);
    expect(await retryAllDlq('docs.scanDocument', provider)).toEqual({ ok: false, error: 'queue_unavailable' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.admin.queueStats.test.ts --mode=unit`
Expected: FAIL — `retryAllDlq` is not exported.

- [ ] **Step 3: Implement retryAllDlq**

Добавь в конец `src/lib/services/admin/queueStats.ts`:

```ts
const BULK_RETRY_CAP = 500;

export type BulkRetryResult =
  | { ok: true; retried: number; failed: number; truncated: boolean }
  | { ok: false; error: 'queue_unavailable' };

/**
 * Retries up to BULK_RETRY_CAP failed jobs in one queue. Per-job retry errors
 * are counted (not thrown) so one stuck job can't block the batch. `truncated`
 * signals the cap was hit and more failures may remain. Audit is written by the
 * caller (route) — queueStats stays prisma-free.
 */
export async function retryAllDlq(
  queue: QueueName,
  provider: QueueProvider = defaultProvider,
): Promise<BulkRetryResult> {
  try {
    const jobs = await provider(queue).getFailed(0, BULK_RETRY_CAP - 1);
    let retried = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        await job.retry();
        retried++;
      } catch {
        failed++;
      }
    }
    return { ok: true, retried, failed, truncated: jobs.length >= BULK_RETRY_CAP };
  } catch {
    return { ok: false, error: 'queue_unavailable' };
  }
}
```

**Note:** `QueueProvider` returns `Pick<Queue, 'getJobCounts' | 'getFailed' | 'getJob'>`; `getFailed` resolves to BullMQ `Job[]`, each with `.retry()`. No seam change needed.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/services.admin.queueStats.test.ts --mode=unit && npm run typecheck`
Expected: PASS (existing + 3 new); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/admin/queueStats.ts src/__tests__/services.admin.queueStats.test.ts
git commit -m "feat(sync-control): retryAllDlq bulk retry (capped)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `registerSyncSchedules` пропускает paused + `loadPausedSchedulerIds`

**Files:**
- Modify: `src/lib/jobs/scheduling.ts:103-127`
- Test: `src/__tests__/jobs.scheduling.test.ts`

- [ ] **Step 1: Add failing tests**

Добавь в `src/__tests__/jobs.scheduling.test.ts`:

```ts
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';

describe('registerSyncSchedules — paused skipping', () => {
  it('skips schedules whose schedulerId is paused', async () => {
    const getQueue = () => ({ upsertJobScheduler: vi.fn(async (id: string) => ({ id })) } as unknown as Queue);
    const result = await registerSyncSchedules(getQueue as never, new Set(['oneCSync.pullOrders.cron']));
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.schedulerId)).not.toContain('oneCSync.pullOrders.cron');
  });
});

describe('loadPausedSchedulerIds', () => {
  it('returns a Set of paused schedulerIds from the DB', async () => {
    const prisma = {
      syncSchedulePause: { findMany: vi.fn().mockResolvedValue([{ schedulerId: 'a' }, { schedulerId: 'b' }]) },
    } as never;
    const set = await loadPausedSchedulerIds(prisma);
    expect(set).toEqual(new Set(['a', 'b']));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/jobs.scheduling.test.ts --mode=unit`
Expected: FAIL — `loadPausedSchedulerIds` not exported; 2nd arg ignored (length 5, contains pullOrders).

- [ ] **Step 3: Implement**

В `src/lib/jobs/scheduling.ts` добавь импорт типа в начало файла:

```ts
import type { PrismaClient } from '@prisma/client';
```

Замени сигнатуру и тело `registerSyncSchedules` (строки ~103-127):

```ts
export async function registerSyncSchedules(
  getQueueFn: GetQueueFn = getQueue,
  pausedSchedulerIds: ReadonlySet<string> = new Set(),
): Promise<RegisteredSchedule[]> {
  const results: RegisteredSchedule[] = [];
  const registeredAt = new Date().toISOString();
  for (const schedule of SYNC_SCHEDULES) {
    if (pausedSchedulerIds.has(schedule.schedulerId)) continue;
    const queue = getQueueFn(schedule.queueName);
    const payload: SyncJobPayload = {
      triggeredAt: registeredAt,
      reason: 'cron'
    };
    await queue.upsertJobScheduler(
      schedule.schedulerId,
      { pattern: schedule.pattern, tz: schedule.tz },
      { data: payload }
    );
    results.push({
      schedulerId: schedule.schedulerId,
      queueName: schedule.queueName,
      pattern: schedule.pattern,
      tz: schedule.tz
    });
  }
  return results;
}

/** Reads the paused-schedule set so the worker can skip them at registration. */
export async function loadPausedSchedulerIds(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.syncSchedulePause.findMany({ select: { schedulerId: true } });
  return new Set(rows.map((r) => r.schedulerId));
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/jobs.scheduling.test.ts --mode=unit && npm run typecheck`
Expected: PASS (existing 4 + 2 new); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jobs/scheduling.ts src/__tests__/jobs.scheduling.test.ts
git commit -m "feat(sync-control): skip paused schedules on registration" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Прокинуть paused-set в worker boot

**Files:**
- Modify: `src/worker/index.ts:67-68`

- [ ] **Step 1: Wire loadPausedSchedulerIds**

В `src/worker/index.ts` обнови импорт расписаний:

```ts
import { registerSyncSchedules, registerCommissionSchedules, registerAlertSchedules, loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { getQueue } from '@/lib/jobs/queues';
```

(если `getQueue` уже импортирован — не дублируй). Затем внутри блока `if (process.env.ENABLE_SYNC_CRON === '1') {` замени строку регистрации sync-расписаний:

```ts
    const pausedIds = await loadPausedSchedulerIds(prisma);
    const syncSchedules = await registerSyncSchedules(getQueue, pausedIds);
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Manual smoke (optional, requires Postgres+Redis)**

Run: `ENABLE_SYNC_CRON=1 npm run worker:dev`
Expected log: `[worker] schedule registered` для незапаузенных; запаузенные отсутствуют.

- [ ] **Step 4: Commit**

```bash
git add src/worker/index.ts
git commit -m "feat(sync-control): worker honors persisted pause flags" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Server-actions (trigger / pause / cursor)

**Files:**
- Create: `src/server-actions/admin/syncControl.ts`
- Test: `src/__tests__/server-actions.admin.syncControl.test.ts`

- [ ] **Step 1: Write failing tests**

Создай `src/__tests__/server-actions.admin.syncControl.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { triggerSync, setSchedulePaused, rewindCursor } = vi.hoisted(() => ({
  triggerSync: vi.fn(), setSchedulePaused: vi.fn(), rewindCursor: vi.fn(),
}));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock('@/lib/services/admin/syncControl', () => ({ triggerSync, setSchedulePaused, rewindCursor }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { triggerSyncAction, setSchedulePausedAction, rewindCursorAction } from '@/server-actions/admin/syncControl';

function fd(entries: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ sub: 'admin-1' });
});

describe('triggerSyncAction', () => {
  it('calls requireAdmin, service, and revalidates on success', async () => {
    triggerSync.mockResolvedValue({ ok: true, jobId: 'manual:order:1' });
    const res = await triggerSyncAction(fd({ entity: 'order' }));
    expect(requireAdmin).toHaveBeenCalled();
    expect(triggerSync).toHaveBeenCalledWith({}, 'admin-1', 'order');
    expect(revalidatePath).toHaveBeenCalledWith('/admin/sync');
    expect(res).toEqual({ ok: true, jobId: 'manual:order:1' });
  });

  it('rejects a missing entity with validation', async () => {
    const res = await triggerSyncAction(fd({}));
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(triggerSync).not.toHaveBeenCalled();
  });

  it('passes through service errors', async () => {
    triggerSync.mockResolvedValue({ ok: false, error: 'already_running' });
    expect(await triggerSyncAction(fd({ entity: 'order' }))).toEqual({ ok: false, error: 'already_running' });
  });
});

describe('setSchedulePausedAction', () => {
  it('coerces paused and calls the service', async () => {
    setSchedulePaused.mockResolvedValue({ ok: true, paused: true });
    const res = await setSchedulePausedAction(fd({ schedulerId: 'oneCSync.pullOrders.cron', paused: 'true' }));
    expect(setSchedulePaused).toHaveBeenCalledWith({}, 'admin-1', 'oneCSync.pullOrders.cron', true);
    expect(res).toEqual({ ok: true, paused: true });
  });
});

describe('rewindCursorAction', () => {
  it('maps empty cursor string to null', async () => {
    rewindCursor.mockResolvedValue({ ok: true, entity: 'order', cursor: null });
    await rewindCursorAction(fd({ entity: 'order', cursor: '' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', null);
  });

  it('forwards an ISO cursor', async () => {
    rewindCursor.mockResolvedValue({ ok: true, entity: 'order', cursor: '2026-06-01T00:00:00.000Z' });
    await rewindCursorAction(fd({ entity: 'order', cursor: '2026-06-01T00:00:00.000Z' }));
    expect(rewindCursor).toHaveBeenCalledWith({}, 'admin-1', 'order', '2026-06-01T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/server-actions.admin.syncControl.test.ts --mode=unit`
Expected: FAIL — module `@/server-actions/admin/syncControl` not found.

- [ ] **Step 3: Implement the server-actions**

Создай `src/server-actions/admin/syncControl.ts`:

```ts
'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  triggerSync,
  setSchedulePaused,
  rewindCursor,
  type TriggerResult,
  type PauseResult,
  type RewindResult,
} from '@/lib/services/admin/syncControl';

type Validation = { ok: false; error: 'validation'; details?: unknown };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

const triggerSchema = z.object({ entity: z.string().min(1) });
const pauseSchema = z.object({ schedulerId: z.string().min(1), paused: z.coerce.boolean() });
const cursorSchema = z.object({ entity: z.string().min(1), cursor: z.string() });

export async function triggerSyncAction(fd: FormData): Promise<TriggerResult | Validation> {
  const parsed = triggerSchema.safeParse({ entity: readField(fd, 'entity') });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };
  const session = await requireAdmin();
  const result = await triggerSync(prisma, session.sub, parsed.data.entity);
  revalidatePath('/admin/sync');
  return result;
}

export async function setSchedulePausedAction(fd: FormData): Promise<PauseResult | Validation> {
  const parsed = pauseSchema.safeParse({ schedulerId: readField(fd, 'schedulerId'), paused: readField(fd, 'paused') });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };
  const session = await requireAdmin();
  const result = await setSchedulePaused(prisma, session.sub, parsed.data.schedulerId, parsed.data.paused);
  revalidatePath('/admin/sync');
  return result;
}

export async function rewindCursorAction(fd: FormData): Promise<RewindResult | Validation> {
  const parsed = cursorSchema.safeParse({ entity: readField(fd, 'entity'), cursor: readField(fd, 'cursor') });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };
  const session = await requireAdmin();
  const cursor = parsed.data.cursor.trim() === '' ? null : parsed.data.cursor;
  const result = await rewindCursor(prisma, session.sub, parsed.data.entity, cursor);
  revalidatePath('/admin/sync');
  return result;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/server-actions.admin.syncControl.test.ts --mode=unit && npm run typecheck`
Expected: PASS (8 tests); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add src/server-actions/admin/syncControl.ts src/__tests__/server-actions.admin.syncControl.test.ts
git commit -m "feat(sync-control): trigger/pause/cursor server-actions" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Bulk-retry API route

**Files:**
- Create: `src/app/api/admin/dlq/[queue]/retry-all/route.ts`
- Test: `src/__tests__/api.admin.dlq.retry-all.test.ts`

- [ ] **Step 1: Write failing tests**

Создай `src/__tests__/api.admin.dlq.retry-all.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireAdmin } = vi.hoisted(() => ({ requireSession: vi.fn(), requireAdmin: vi.fn() }));
const { retryAllDlq } = vi.hoisted(() => ({ retryAllDlq: vi.fn() }));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireAdmin }));
vi.mock('@/lib/services/admin/queueStats', () => ({ retryAllDlq }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/admin/dlq/[queue]/retry-all/route';

function params(queue: string) {
  return { params: Promise.resolve({ queue }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ ok: true, value: { sub: 'admin-1', role: 'admin' } });
  requireAdmin.mockReturnValue({ ok: true, value: { sub: 'admin-1' } });
  recordAudit.mockResolvedValue(undefined);
});

describe('POST retry-all', () => {
  it('rejects an unknown queue with 400', async () => {
    const res = await POST(new Request('http://x', { method: 'POST' }), params('bogus.queue'));
    expect(res.status).toBe(400);
    expect(retryAllDlq).not.toHaveBeenCalled();
  });

  it('retries, audits, and returns counts on success', async () => {
    retryAllDlq.mockResolvedValue({ ok: true, retried: 3, failed: 0, truncated: false });
    const res = await POST(new Request('http://x', { method: 'POST' }), params('docs.scanDocument'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ retried: 3, failed: 0, truncated: false });
    expect(recordAudit).toHaveBeenCalledWith({}, expect.objectContaining({ entity: 'job_queue', entityId: 'docs.scanDocument', action: 'sync_dlq_bulk_retried' }));
  });

  it('maps queue_unavailable to 503', async () => {
    retryAllDlq.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    const res = await POST(new Request('http://x', { method: 'POST' }), params('docs.scanDocument'));
    expect(res.status).toBe(503);
  });

  it('returns the guard response when not admin', async () => {
    requireAdmin.mockReturnValue({ ok: false, response: new Response('forbidden', { status: 403 }) });
    const res = await POST(new Request('http://x', { method: 'POST' }), params('docs.scanDocument'));
    expect(res.status).toBe(403);
    expect(retryAllDlq).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/api.admin.dlq.retry-all.test.ts --mode=unit`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Создай `src/app/api/admin/dlq/[queue]/retry-all/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { requireAdmin, requireSession } from '@/lib/auth/guard';
import { QUEUE_NAMES, type QueueName } from '@/lib/jobs/queues';
import { retryAllDlq } from '@/lib/services/admin/queueStats';
import { recordAudit } from '@/lib/auth/audit';
import { prisma } from '@/lib/db/prisma';

type Params = { params: Promise<{ queue: string }> };

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

export async function POST(_req: Request, { params }: Params) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const adminGuard = requireAdmin(sessionResult.value);
  if (!adminGuard.ok) return adminGuard.response;

  const { queue } = await params;
  if (!isKnownQueue(queue)) {
    return NextResponse.json({ error: 'UNKNOWN_QUEUE' }, { status: 400 });
  }

  const result = await retryAllDlq(queue);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }

  await recordAudit(prisma, {
    userId: sessionResult.value.sub,
    action: 'sync_dlq_bulk_retried',
    entity: 'job_queue',
    entityId: queue,
    after: { retried: result.retried, failed: result.failed, truncated: result.truncated },
  }).catch((e) => console.warn('[dlq/retry-all] audit failed', e));

  return NextResponse.json({ retried: result.retried, failed: result.failed, truncated: result.truncated });
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/__tests__/api.admin.dlq.retry-all.test.ts --mode=unit && npm run typecheck`
Expected: PASS (4 tests); 0 type errors.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/admin/dlq/[queue]/retry-all/route.ts" src/__tests__/api.admin.dlq.retry-all.test.ts
git commit -m "feat(sync-control): bulk-retry DLQ route (guard + audit)" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Клиентские компоненты пульта

**Files:**
- Create: `src/components/admin/sync-trigger-button.tsx`
- Create: `src/components/admin/sync-schedule-toggle.tsx`
- Create: `src/components/admin/sync-cursor-dialog.tsx`
- Create: `src/components/admin/retry-all-button.tsx`
- Test: `src/__tests__/components.sync-cursor-dialog.test.ts`

- [ ] **Step 1: Write failing tests for the pure confirm-gate + initial render**

Создай `src/__tests__/components.sync-cursor-dialog.test.ts`:

```ts
import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/server-actions/admin/syncControl', () => ({ rewindCursorAction: vi.fn() }));

import { confirmArmed, SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';

describe('confirmArmed', () => {
  it('is false until the typed name matches the entity', () => {
    expect(confirmArmed('', 'order')).toBe(false);
    expect(confirmArmed('ord', 'order')).toBe(false);
    expect(confirmArmed(' order ', 'order')).toBe(true);
    expect(confirmArmed('order', 'order')).toBe(true);
  });
});

describe('SyncCursorDialog initial render', () => {
  it('renders the entity name and a disabled confirm button when closed-armed', () => {
    const html = renderToString(
      React.createElement(SyncCursorDialog, { entity: 'order', currentCursor: '2026-06-05T00:00:00.000Z' }),
    );
    expect(html).toContain('order');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/components.sync-cursor-dialog.test.ts --mode=unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement sync-cursor-dialog.tsx**

Создай `src/components/admin/sync-cursor-dialog.tsx`:

```tsx
'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { rewindCursorAction } from '@/server-actions/admin/syncControl';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Проверьте значение даты.',
  unknown_entity: 'Неизвестная сущность.',
  invalid_cursor: 'Недопустимое значение курсора (в будущем или не дата).',
  storage: 'Ошибка записи.',
};

/** Pure gate: confirm is armed only when the typed name matches the entity. */
export function confirmArmed(typed: string, entityName: string): boolean {
  return typed.trim() === entityName;
}

export function SyncCursorDialog({
  entity,
  currentCursor,
}: {
  entity: string;
  currentCursor: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    setTyped('');
    setValue('');
    setError(null);
  }

  function submit(reset: boolean) {
    setError(null);
    const fd = new FormData();
    fd.set('entity', entity);
    fd.set('cursor', reset ? '' : value);
    startTransition(async () => {
      const res = await rewindCursorAction(fd);
      if (res.ok) {
        close();
        router.refresh();
      } else {
        setError(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
      }
    });
  }

  const armed = confirmArmed(typed, entity);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors"
      >
        Курсор…
      </button>

      <Dialog open={open} onClose={close} title={`Перемотка курсора: ${entity}`} size="md" busy={pending} error={error ?? undefined}>
        <div className="space-y-3">
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
            ⚠️ Перемотка вызовет повторный pull всех изменений 1С с указанного момента. Сброс (пустое поле) = полный re-pull с начала. Текущий курсор: <span className="font-mono">{currentCursor ?? '—'}</span>.
          </p>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">Новый курсор (дата/время)</span>
            <input
              type="datetime-local"
              value={value}
              onChange={(e) => setValue(e.target.value ? new Date(e.target.value).toISOString() : '')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-gray-700 mb-1">
              Для подтверждения введите имя сущности: <span className="font-mono">{entity}</span>
            </span>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#F97316]"
            />
          </label>
          <div className="flex justify-between gap-2 pt-2">
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={!armed || pending}
              className="px-3 py-2 border border-red-300 text-red-700 text-sm rounded-lg hover:bg-red-50 disabled:opacity-50"
            >
              Сбросить (полный re-pull)
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={close} className="px-4 py-2 border border-gray-200 text-sm rounded-lg hover:bg-gray-50">
                Отмена
              </button>
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={!armed || pending || value === ''}
                className="px-4 py-2 bg-[#F97316] text-white text-sm rounded-lg hover:bg-[#EA580C] disabled:opacity-50"
              >
                {pending ? 'Применяем…' : 'Перемотать'}
              </button>
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 4: Run dialog tests + typecheck**

Run: `npx vitest run src/__tests__/components.sync-cursor-dialog.test.ts --mode=unit && npm run typecheck`
Expected: PASS (2 tests); 0 type errors.

- [ ] **Step 5: Implement the three simpler buttons (no new tests — exercised in e2e/manual)**

Создай `src/components/admin/sync-trigger-button.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { triggerSyncAction } from '@/server-actions/admin/syncControl';

const ERROR_LABELS: Record<string, string> = {
  validation: 'Некорректный запрос.',
  unknown_entity: 'Неизвестная сущность.',
  already_running: 'Синк уже выполняется.',
  queue_unavailable: 'Очередь недоступна (Redis).',
};

export function SyncTriggerButton({ entity }: { entity: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    const fd = new FormData();
    fd.set('entity', entity);
    startTransition(async () => {
      const res = await triggerSyncAction(fd);
      if (res.ok) router.refresh();
      else setErr(ERROR_LABELS[res.error] ?? `Ошибка: ${res.error}`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors disabled:opacity-50"
      >
        {pending ? 'Запуск…' : 'Запустить'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
```

Создай `src/components/admin/sync-schedule-toggle.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setSchedulePausedAction } from '@/server-actions/admin/syncControl';

export function SyncScheduleToggle({ schedulerId, paused }: { schedulerId: string; paused: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    setErr(null);
    const fd = new FormData();
    fd.set('schedulerId', schedulerId);
    fd.set('paused', String(!paused));
    startTransition(async () => {
      const res = await setSchedulePausedAction(fd);
      if (res.ok) router.refresh();
      else setErr(res.error === 'queue_unavailable' ? 'Очередь недоступна (Redis).' : `Ошибка: ${res.error}`);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
          paused
            ? 'border-yellow-400 text-yellow-700 hover:bg-yellow-50'
            : 'border-gray-300 text-gray-700 hover:border-[#F97316] hover:text-[#F97316]'
        }`}
      >
        {pending ? '…' : paused ? 'На паузе — включить' : 'Активно — пауза'}
      </button>
      {err && <span className="text-xs text-red-700">{err}</span>}
    </div>
  );
}
```

Создай `src/components/admin/retry-all-button.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function RetryAllButton({ queue }: { queue: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/dlq/${encodeURIComponent(queue)}/retry-all`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`);
        return;
      }
      setMsg(`Повторно: ${body.retried ?? 0}${body.truncated ? ' (обрезано до 500)' : ''}`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-xs px-2 py-1 rounded border border-gray-300 hover:border-[#F97316] hover:text-[#F97316] transition-colors disabled:opacity-50"
      >
        {busy ? 'Повтор…' : 'Повторить все'}
      </button>
      {msg && <span className="text-xs text-gray-600">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/sync-trigger-button.tsx src/components/admin/sync-schedule-toggle.tsx src/components/admin/sync-cursor-dialog.tsx src/components/admin/retry-all-button.tsx src/__tests__/components.sync-cursor-dialog.test.ts
git commit -m "feat(sync-control): admin control-panel client components" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Связать страницы (`/admin/sync` + `/admin/health`)

**Files:**
- Modify: `src/app/admin/sync/page.tsx`
- Modify: `src/app/admin/health/page.tsx`

- [ ] **Step 1: Rewrite the sync page as a control center**

Замени содержимое `src/app/admin/sync/page.tsx`:

```tsx
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { getSyncSummary, type SyncSummaryRow } from '@/lib/services/syncSummary';
import { getQueueStats } from '@/lib/services/admin/queueStats';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';
import { SYNC_ENTITIES, type SyncControlEntity } from '@/lib/services/admin/syncControl';
import { SyncTriggerButton } from '@/components/admin/sync-trigger-button';
import { SyncScheduleToggle } from '@/components/admin/sync-schedule-toggle';
import { SyncCursorDialog } from '@/components/admin/sync-cursor-dialog';

export const dynamic = 'force-dynamic';

const ENTITY_RU: Record<SyncSummaryRow['entity'], string> = {
  organization: 'Организации',
  order: 'Заказы',
  payment: 'Платежи',
  document: 'Документы',
};

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

export default async function AdminSyncPage() {
  await requireAdmin();

  const [rows, queueStats, pausedIds] = await Promise.all([
    getSyncSummary(prisma),
    getQueueStats().catch(() => []),
    loadPausedSchedulerIds(prisma).catch(() => new Set<string>()),
  ]);

  const activeByQueue = new Map(queueStats.map((q) => [q.queue, q.counts.active]));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Управление синхронизацией с 1С</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Запуск, пауза расписания и перемотка курсора по сущностям. Bulk-retry упавших задач —{' '}
          <a href="/admin/health" className="text-[#F97316] hover:underline">на странице Здоровья</a>.
        </p>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Сущность</th>
              <th className="text-left px-4 py-3 font-medium">Последний успех</th>
              <th className="text-left px-4 py-3 font-medium">Сейчас</th>
              <th className="text-left px-4 py-3 font-medium">Запуск</th>
              <th className="text-left px-4 py-3 font-medium">Расписание</th>
              <th className="text-left px-4 py-3 font-medium">Курсор</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cfg = SYNC_ENTITIES[r.entity as SyncControlEntity];
              const active = activeByQueue.get(cfg.queueName) ?? 0;
              const paused = pausedIds.has(cfg.schedulerId);
              return (
                <tr key={r.entity} className="border-t border-gray-100">
                  <td className="px-4 py-3 text-[#111111] font-medium">{ENTITY_RU[r.entity]}</td>
                  <td className="px-4 py-3 text-gray-700">{formatDate(r.lastSuccessAt)}</td>
                  <td className="px-4 py-3">
                    {active > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">выполняется</span>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><SyncTriggerButton entity={r.entity} /></td>
                  <td className="px-4 py-3"><SyncScheduleToggle schedulerId={cfg.schedulerId} paused={paused} /></td>
                  <td className="px-4 py-3">
                    <SyncCursorDialog entity={r.entity} currentCursor={r.cursor ?? null} />
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-gray-100 bg-gray-50/50">
              <td className="px-4 py-3 text-[#111111] font-medium">Сверка (reconcile)</td>
              <td className="px-4 py-3 text-gray-400">—</td>
              <td className="px-4 py-3">
                {(activeByQueue.get('oneCSync.reconcile') ?? 0) > 0 ? (
                  <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">выполняется</span>
                ) : (
                  <span className="text-gray-400 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3"><SyncTriggerButton entity="reconcile" /></td>
              <td className="px-4 py-3">
                <SyncScheduleToggle schedulerId="oneCSync.reconcile.cron" paused={pausedIds.has('oneCSync.reconcile.cron')} />
              </td>
              <td className="px-4 py-3 text-gray-400 text-xs">нет курсора</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Note:** `getSyncSummary` row has `entity` ∈ {organization, order, payment, document} (см. [syncHealth.ts](../../src/lib/services/admin/syncHealth.ts)) — все 4 присутствуют в `SYNC_ENTITIES`, поэтому `SYNC_ENTITIES[r.entity as SyncControlEntity]` безопасно. `r.cursor` — ISO-строка watermark.

- [ ] **Step 2: Add bulk-retry to the health page DLQ section**

В `src/app/admin/health/page.tsx` добавь импорт:

```ts
import { RetryAllButton } from '@/components/admin/retry-all-button';
```

Замени секцию «Упавшие задачи» (строки ~108-111) на:

```tsx
      <section className='space-y-3'>
        <div className='flex items-center justify-between'>
          <h2 className='text-base font-semibold text-[#111111]'>Упавшие задачи (последние 50)</h2>
        </div>
        {[...new Set(dlqRows.map((r) => r.queue))].length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {[...new Set(dlqRows.map((r) => r.queue))].map((q) => (
              <div key={q} className='flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5'>
                <span className='font-mono text-xs text-gray-600'>{q}</span>
                <RetryAllButton queue={q} />
              </div>
            ))}
          </div>
        )}
        <DlqTable rows={dlqRows} />
      </section>
```

- [ ] **Step 3: Verify typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: 0 type errors; build succeeds, routes include `/api/admin/dlq/[queue]/retry-all`.

- [ ] **Step 4: Manual smoke (requires dev + seed + Postgres)**

Run: `npm run dev`, войти как `admin@demo.local` / `Password123!`, открыть `/admin/sync`.
Expected: таблица с кнопками Запустить / пауза-тумблер / Курсор…; `/admin/health` показывает «Повторить все» на очередь с упавшими задачами.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/sync/page.tsx src/app/admin/health/page.tsx
git commit -m "feat(sync-control): wire control center into /admin/sync + /admin/health" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Integration-тесты (живой Postgres)

**Files:**
- Create: `src/__tests__/services.admin.syncControl.integration.test.ts`

- [ ] **Step 1: Write integration tests against a real PrismaClient**

Создай `src/__tests__/services.admin.syncControl.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { rewindCursor, setSchedulePaused } from '@/lib/services/admin/syncControl';
import { loadPausedSchedulerIds } from '@/lib/jobs/scheduling';

const prisma = new PrismaClient();
const ENTITY = 'order';
const SCHED = 'oneCSync.pullOrders.cron';
const ACTOR = 'integration-admin';

// Provider stub: pause must not require live Redis in this test.
const noopProvider = () =>
  ({ getJobCounts: async () => ({}), add: async () => ({}), upsertJobScheduler: async () => ({}), removeJobScheduler: async () => true }) as never;

beforeAll(async () => {
  await prisma.syncSchedulePause.deleteMany({ where: { schedulerId: SCHED } });
});

afterAll(async () => {
  await prisma.syncSchedulePause.deleteMany({ where: { schedulerId: SCHED } });
  await prisma.$disconnect();
});

describe('rewindCursor (integration)', () => {
  it('writes SyncState.cursor and an audit row atomically', async () => {
    const res = await rewindCursor(prisma, ACTOR, ENTITY, '2026-06-01T00:00:00.000Z');
    expect(res).toEqual({ ok: true, entity: ENTITY, cursor: '2026-06-01T00:00:00.000Z' });

    const state = await prisma.syncState.findUnique({ where: { entity: ENTITY } });
    expect(state?.cursor).toBe('2026-06-01T00:00:00.000Z');

    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'sync_state', entityId: ENTITY, action: 'cursor_rewound' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
  });
});

describe('setSchedulePaused (integration)', () => {
  it('pause creates a row that loadPausedSchedulerIds reads back; resume removes it', async () => {
    const pause = await setSchedulePaused(prisma, ACTOR, SCHED, true, noopProvider);
    expect(pause).toEqual({ ok: true, paused: true });
    expect(await loadPausedSchedulerIds(prisma)).toContain(SCHED);

    const resume = await setSchedulePaused(prisma, ACTOR, SCHED, false, noopProvider);
    expect(resume).toEqual({ ok: true, paused: false });
    expect(await loadPausedSchedulerIds(prisma)).not.toContain(SCHED);
  });
});
```

**Note:** наличие `new PrismaClient(` авто-классифицирует файл как integration (vitest mode-partitioning, CLAUDE.md §6) — спец-регистрации не требует.

- [ ] **Step 2: Run against live Postgres**

Run: `npm run test:integration -- src/__tests__/services.admin.syncControl.integration.test.ts`
Expected: PASS (2 tests). (Требует живой Postgres; `Set.prototype` matcher `toContain` работает на Set в vitest.)

- [ ] **Step 3: Run the full gate (worker/services touched)**

Run: `npm run gate`
Expected: Docker-Postgres поднят, миграции применены, integration-слой зелёный (включая новый файл + cross-checks).

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/services.admin.syncControl.integration.test.ts
git commit -m "test(sync-control): integration for cursor rewind + pause persistence" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full unit layer**

Run: `npm run test:unit`
Expected: всё зелёное (новые: ~15 syncControl + 3 queueStats + 2 scheduling + 8 server-actions + 4 route + 2 dialog + 1 audit).

- [ ] **Run typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 0 errors / 0 new warnings / build OK.

- [ ] **Push the branch**

```bash
git push -u origin claude/admin-sync-control-spec
```

---

## Deferred / follow-up (не в этом плане)

- **e2e visual snapshot** `/admin/sync` control center — baseline генерируется на staged Linux/Chromium (`npm run e2e:visual:update`), не коммитится с Windows (паттерн прошлых фаз). Добавить `admin-sync-control.spec.ts` при следующем staged-прогоне.
- Подсистемы **B** (страница алертов), **C** (управление Company), **D** (runtime feature-flag тумблеры) — отдельные spec → plan циклы.
- Открытые вопросы спеки §10: cross-process дедуп manual-триггера; каскадный сброс `lastError` при перемотке; видимость живости воркера.

---

## Self-review (выполнено автором плана)

**Покрытие спеки:**
- §3.1 triggerSync → Task 4 ✓; §3.2 retryAllDlq → Task 6 + route Task 10 ✓; §3.3 setSchedulePaused → Task 5 + worker Task 7/8 ✓; §3.4 rewindCursor → Task 3 ✓.
- §4 SyncSchedulePause → Task 2 ✓. §5 worker paused-set → Task 7/8 ✓. §3 AuditEntity → Task 1 ✓.
- §6 два guard-модуля → server-actions (Task 9, `requireRole`) + route (Task 10, `guard`) ✓. type-to-confirm → Task 11 (`confirmArmed`) ✓. §8 UI → Task 12 ✓. §9 тесты → каждый слой ✓.
- §7 коды ошибок: `already_running`/`queue_unavailable`/`unknown_entity` (trigger), `queue_unavailable` (retryAll; `unknown_queue`→400 в роуте), `unknown_schedule`/`queue_unavailable` (pause), `unknown_entity`/`invalid_cursor`/`storage` (cursor) — все покрыты тестами.

**Type consistency:** `SyncControlEntity`, `SyncControlQueueProvider`, `defaultSyncProvider`, `TriggerResult`/`PauseResult`/`RewindResult`/`BulkRetryResult` определены в Task 3/4/5/6 и используются согласованно в Task 9/10/11/12. `loadPausedSchedulerIds` определена в Task 7, используется в Task 8/12. Actions возвращают `… | Validation`.

**Placeholder scan:** нет TBD/TODO; весь код приведён целиком; команды с ожидаемым результатом.
