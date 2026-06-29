# 1C cursor skipped-record loss — store-and-replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the 1C inbound sync from silently losing out-of-order records (e.g. a payment that arrives before its organization) by capturing every transiently-skipped record and replaying it through the idempotent writer until its dependency appears or it is dead-lettered.

**Architecture:** When a sync batch skips a record for a *transient* reason (dependency not yet synced), persist the record's raw DTO into a new `OneCPendingRecord` table. After each entity pull, a replay pass re-runs the entity's idempotent writer against pending DTOs; success deletes the row, a repeated transient skip increments `attempts`, and a permanent skip or exceeding the attempt/age cap dead-letters the row (`status='dead'`) for the existing alert pass to surface. The high-water-mark cursor keeps advancing normally — no stall, no loss. This **supersedes** spec Options A/B: the `OneCAdapter` interface is bulk-pull only (no fetch-by-externalId), so re-pull is infeasible; replaying the stored DTO achieves the same recovery without adapter or 1C-side changes.

**Tech Stack:** Prisma 5 + PostgreSQL, BullMQ worker processors, Vitest (unit + integration), Zod schemas as DTO source of truth.

**Spec:** [docs/superpowers/specs/2026-06-29-1c-cursor-skipped-record-loss-design.md](../specs/2026-06-29-1c-cursor-skipped-record-loss-design.md)

---

## File Structure

- Create: `prisma/schema.prisma` change + new migration — `OneCPendingRecord` model.
- Create: `src/lib/services/oneCSync/pending.ts` — transient classifier, capture, replay, dead-letter (the whole store-and-replay unit lives in one focused module).
- Create: `src/__tests__/oneCSync.pending.unit.test.ts` — unit tests (mocked Prisma + writers).
- Create: `src/__tests__/services.oneCSync.pending.integration.test.ts` — integration tests (live Postgres).
- Modify: `src/lib/services/oneCSync/config.ts` — env readers `oneCPendingMaxAttempts()`, `oneCPendingMaxAgeDays()`.
- Modify: `src/worker/processors/sync-payments.ts`, `sync-orders.ts`, `sync-documents.ts`, `sync-organizations.ts` — call capture + replay.
- Modify: `src/lib/monitoring/*` (thresholds) — surface dead-lettered pending count as an alert.

---

## Task 1: `OneCPendingRecord` schema + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model after `SyncState`, around line 361)
- Create: `prisma/migrations/<timestamp>_one_c_pending_record/migration.sql` (generated)

- [ ] **Step 1: Add the model to `prisma/schema.prisma`** (insert after the `SyncState` model, before `SyncSchedulePause`)

```prisma
model OneCPendingRecord {
  id          String   @id @default(cuid())
  entity      String   // 'organization' | 'order' | 'payment' | 'document'
  externalId  String
  dto         Json     // raw 1C DTO, replayed verbatim through the idempotent writer
  reason      String   // last transient skip reason
  attempts    Int      @default(0)
  status      String   @default("pending") // 'pending' | 'dead'
  firstSeenAt DateTime @default(now())
  lastTriedAt DateTime @updatedAt

  @@unique([entity, externalId])
  @@index([status, entity])
}
```

- [ ] **Step 2: Generate the migration + client**

Run: `npm run prisma:migrate -- --name one_c_pending_record`
Expected: a new folder `prisma/migrations/<ts>_one_c_pending_record/` with `CREATE TABLE "OneCPendingRecord"`, and `prisma generate` regenerates the client (the `prisma.oneCPendingRecord` delegate now exists).

- [ ] **Step 3: Verify typecheck sees the new delegate**

Run: `npm run typecheck`
Expected: PASS (no errors). If `prisma.oneCPendingRecord` is missing, re-run `npm run prisma:generate`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(1c): OneCPendingRecord model for store-and-replay of skipped records"
```

---

## Task 2: Transient-skip classifier

A skip is *transient* (re-pulling/replaying may later succeed) vs *permanent* (replaying re-skips forever). Only transient skips are captured; a permanent skip on replay dead-letters immediately.

**Files:**
- Create: `src/lib/services/oneCSync/pending.ts`
- Create: `src/__tests__/oneCSync.pending.unit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.pending.unit.test.ts
import { describe, it, expect } from 'vitest';
import { isTransientSkip } from '@/lib/services/oneCSync/pending';

describe('isTransientSkip', () => {
  it('treats dependency-ordering skips as transient', () => {
    expect(isTransientSkip('organization_not_found')).toBe(true);
    expect(isTransientSkip('order_not_found')).toBe(true);
    expect(isTransientSkip('document_fetch_failed')).toBe(true);
  });
  it('treats partner/scope skips as permanent', () => {
    expect(isTransientSkip('partner_not_found')).toBe(false);
    expect(isTransientSkip('no_partner_external_id')).toBe(false);
    expect(isTransientSkip('out_of_scope')).toBe(false);
  });
  it('treats unknown reasons as permanent (fail closed — do not retry forever)', () => {
    expect(isTransientSkip('something_new')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: FAIL — `isTransientSkip` is not exported from a non-existent module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/services/oneCSync/pending.ts
/** Skip reasons whose dependency may appear on a later sync, so the record is worth replaying. */
const TRANSIENT_REASONS = new Set(['organization_not_found', 'order_not_found', 'document_fetch_failed']);

/** True only for known dependency-ordering skips. Unknown/permanent reasons fail closed (no retry). */
export function isTransientSkip(reason: string): boolean {
  return TRANSIENT_REASONS.has(reason);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/pending.ts src/__tests__/oneCSync.pending.unit.test.ts
git commit -m "feat(1c): transient-skip classifier for pending replay"
```

---

## Task 3: Capture transient skips after a batch

After a sync batch, persist each transiently-skipped record's raw DTO into `OneCPendingRecord` (upsert by `entity+externalId`, resetting `status` to `pending` and bumping `reason`). A successful record that had a stale pending row is cleaned up by replay (Task 4), not here.

**Files:**
- Modify: `src/lib/services/oneCSync/pending.ts`
- Modify: `src/__tests__/oneCSync.pending.unit.test.ts`

- [ ] **Step 1: Write the failing test** (append to the unit test file)

```ts
import { capturePendingSkips, type CursorEntity } from '@/lib/services/oneCSync/pending';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';
import { vi } from 'vitest';

describe('capturePendingSkips', () => {
  const rawByExt = (ext: string) => ({ externalId: ext, updatedAt: '2026-06-01T00:00:00Z' });

  it('upserts a pending row for each transient skip, matched to its raw DTO', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { upsert } } as never;
    const raw = [rawByExt('P1'), rawByExt('P2'), rawByExt('P3')];
    const summary = emptySummary();
    summary.skips = [
      { externalId: 'P1', reason: 'organization_not_found' }, // transient → captured
      { externalId: 'P3', reason: 'out_of_scope' },           // permanent → ignored
    ];

    await capturePendingSkips(db, 'payment' as CursorEntity, raw, (r) => (r as { externalId: string }).externalId, summary);

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith({
      where: { entity_externalId: { entity: 'payment', externalId: 'P1' } },
      create: { entity: 'payment', externalId: 'P1', dto: raw[0], reason: 'organization_not_found' },
      update: { reason: 'organization_not_found', status: 'pending' },
    });
  });

  it('does nothing when there are no transient skips', async () => {
    const upsert = vi.fn();
    const db = { oneCPendingRecord: { upsert } } as never;
    const summary = emptySummary();
    summary.skips = [{ externalId: 'X', reason: 'partner_not_found' }];
    await capturePendingSkips(db, 'organization' as CursorEntity, [rawByExt('X')], (r) => (r as { externalId: string }).externalId, summary);
    expect(upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: FAIL — `capturePendingSkips` / `CursorEntity` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `pending.ts`)

```ts
import type { PrismaClient } from '@prisma/client';
import type { BatchSummary } from './record-batch';

export type CursorEntity = 'organization' | 'order' | 'payment' | 'document';

/**
 * Persist transiently-skipped records so they can be replayed once their dependency
 * (org/order) appears. Stores the raw DTO verbatim; matched to a skip by externalId.
 */
export async function capturePendingSkips<T>(
  db: PrismaClient,
  entity: CursorEntity,
  raw: T[],
  getExternalId: (r: T) => string,
  summary: BatchSummary
): Promise<void> {
  const transient = summary.skips.filter((s) => isTransientSkip(s.reason));
  if (transient.length === 0) return;
  const byExt = new Map(raw.map((r) => [getExternalId(r), r]));
  for (const skip of transient) {
    const dto = byExt.get(skip.externalId);
    if (dto === undefined) continue; // defensive: skip referenced a record not in this batch
    await db.oneCPendingRecord.upsert({
      where: { entity_externalId: { entity, externalId: skip.externalId } },
      create: { entity, externalId: skip.externalId, dto: dto as object, reason: skip.reason },
      update: { reason: skip.reason, status: 'pending' },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/pending.ts src/__tests__/oneCSync.pending.unit.test.ts
git commit -m "feat(1c): capture transient skips into OneCPendingRecord"
```

---

## Task 4: Config readers for the dead-letter cap

**Files:**
- Modify: `src/lib/services/oneCSync/config.ts`
- Create: `src/__tests__/oneCSync.pending.config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/oneCSync.pending.config.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { oneCPendingMaxAttempts, oneCPendingMaxAgeDays } from '@/lib/services/oneCSync/config';

afterEach(() => { delete process.env.ONE_C_PENDING_MAX_ATTEMPTS; delete process.env.ONE_C_PENDING_MAX_AGE_DAYS; });

describe('pending dead-letter config', () => {
  it('defaults: 50 attempts, 7 days', () => {
    expect(oneCPendingMaxAttempts()).toBe(50);
    expect(oneCPendingMaxAgeDays()).toBe(7);
  });
  it('reads overrides from env', () => {
    process.env.ONE_C_PENDING_MAX_ATTEMPTS = '10';
    process.env.ONE_C_PENDING_MAX_AGE_DAYS = '3';
    expect(oneCPendingMaxAttempts()).toBe(10);
    expect(oneCPendingMaxAgeDays()).toBe(3);
  });
  it('ignores non-positive / non-numeric env and falls back to default', () => {
    process.env.ONE_C_PENDING_MAX_ATTEMPTS = '0';
    process.env.ONE_C_PENDING_MAX_AGE_DAYS = 'abc';
    expect(oneCPendingMaxAttempts()).toBe(50);
    expect(oneCPendingMaxAgeDays()).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.config.test.ts`
Expected: FAIL — readers not exported.

- [ ] **Step 3: Write minimal implementation** (append to `config.ts`, mirroring the existing positive-int reader style there)

```ts
function positiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Max replay attempts before a pending record is dead-lettered. */
export function oneCPendingMaxAttempts(): number {
  return positiveIntEnv('ONE_C_PENDING_MAX_ATTEMPTS', 50);
}

/** Max age (days) before a still-pending record is dead-lettered. */
export function oneCPendingMaxAgeDays(): number {
  return positiveIntEnv('ONE_C_PENDING_MAX_AGE_DAYS', 7);
}
```

> If `config.ts` already has an equivalent positive-int helper, reuse it instead of adding `positiveIntEnv` (DRY — check before adding).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/config.ts src/__tests__/oneCSync.pending.config.test.ts
git commit -m "feat(1c): config readers for pending dead-letter cap"
```

---

## Task 5: Replay pending records (with dead-letter)

Replay re-runs the entity's idempotent writer against each pending DTO. Success → delete the row. Transient skip again → bump `attempts`; if `attempts >= max` or age `>= maxAgeDays` → dead-letter. Permanent skip or thrown error → bump `attempts` and dead-letter on cap.

**Files:**
- Modify: `src/lib/services/oneCSync/pending.ts`
- Modify: `src/__tests__/oneCSync.pending.unit.test.ts`

- [ ] **Step 1: Write the failing test** (append)

```ts
import { replayPendingRecords } from '@/lib/services/oneCSync/pending';

// Mock the writers + schemas the replay dispatches to.
const { upsertPaymentRecord } = vi.hoisted(() => ({ upsertPaymentRecord: vi.fn() }));
vi.mock('@/lib/services/oneCSync/writers', () => ({
  upsertOrgRecord: vi.fn(), upsertOrderRecord: vi.fn(), upsertPaymentRecord, upsertDocumentRecord: vi.fn(),
}));

function pendingRow(over = {}) {
  return {
    id: 'pr1', entity: 'payment', externalId: 'P1',
    dto: { externalId: 'P1', amount: 1, paidAt: '2026-06-01T00:00:00Z', isRefund: false, organizationInn: '77', updatedAt: '2026-06-01T00:00:00Z' },
    reason: 'organization_not_found', attempts: 0, status: 'pending',
    firstSeenAt: new Date('2026-06-20T00:00:00Z'), lastTriedAt: new Date('2026-06-20T00:00:00Z'),
    ...over,
  };
}

describe('replayPendingRecords', () => {
  beforeEach(() => upsertPaymentRecord.mockReset());

  it('deletes the row when the writer now succeeds (dependency appeared)', async () => {
    upsertPaymentRecord.mockImplementation(async (_db, _dto, sum) => { sum.created += 1; });
    const findMany = vi.fn().mockResolvedValue([pendingRow()]);
    const del = vi.fn().mockResolvedValue({});
    const update = vi.fn();
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;

    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-21T00:00:00Z') });

    expect(del).toHaveBeenCalledWith({ where: { id: 'pr1' } });
    expect(update).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 1, deadLettered: 0, stillPending: 0 });
  });

  it('bumps attempts and keeps pending on a repeated transient skip below the cap', async () => {
    upsertPaymentRecord.mockImplementation(async (_db, _dto, sum) => { sum.skipped += 1; sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' }); });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 2 })]);
    const del = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: del, update } } as never;

    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-21T00:00:00Z'), maxAttempts: 50, maxAgeDays: 7 });

    expect(update).toHaveBeenCalledWith({ where: { id: 'pr1' }, data: { attempts: 3, reason: 'organization_not_found' } });
    expect(del).not.toHaveBeenCalled();
    expect(res).toMatchObject({ resolved: 0, deadLettered: 0, stillPending: 1 });
  });

  it('dead-letters when attempts reach the cap', async () => {
    upsertPaymentRecord.mockImplementation(async (_db, _dto, sum) => { sum.skipped += 1; sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' }); });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 49 })]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;

    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-21T00:00:00Z'), maxAttempts: 50, maxAgeDays: 7 });

    expect(update).toHaveBeenCalledWith({ where: { id: 'pr1' }, data: { attempts: 50, status: 'dead', reason: 'organization_not_found' } });
    expect(res).toMatchObject({ deadLettered: 1 });
  });

  it('dead-letters a record older than the age cap regardless of attempts', async () => {
    upsertPaymentRecord.mockImplementation(async (_db, _dto, sum) => { sum.skipped += 1; sum.skips.push({ externalId: 'P1', reason: 'organization_not_found' }); });
    const findMany = vi.fn().mockResolvedValue([pendingRow({ attempts: 1, firstSeenAt: new Date('2026-06-01T00:00:00Z') })]);
    const update = vi.fn().mockResolvedValue({});
    const db = { oneCPendingRecord: { findMany, delete: vi.fn(), update } } as never;

    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-21T00:00:00Z'), maxAttempts: 50, maxAgeDays: 7 });

    expect(update).toHaveBeenCalledWith({ where: { id: 'pr1' }, data: { attempts: 2, status: 'dead', reason: 'organization_not_found' } });
    expect(res).toMatchObject({ deadLettered: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: FAIL — `replayPendingRecords` not exported.

- [ ] **Step 3: Write minimal implementation** (add to `pending.ts`)

```ts
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema, OneCDocumentSchema } from './schemas';
import { upsertOrgRecord, upsertOrderRecord, upsertPaymentRecord, upsertDocumentRecord } from './writers';
import { emptySummary } from './record-batch';
import { oneCPendingMaxAttempts, oneCPendingMaxAgeDays } from './config';

type ReplayResult = { resolved: number; deadLettered: number; stillPending: number };

// entity → (zod schema, idempotent writer). Replaying the stored DTO is equivalent to
// re-pulling it, but works with the bulk-only adapter (no fetch-by-externalId).
const DISPATCH = {
  organization: { schema: OneCOrgSchema, write: upsertOrgRecord },
  order: { schema: OneCOrderSchema, write: upsertOrderRecord },
  payment: { schema: OneCPaymentSchema, write: upsertPaymentRecord },
  document: { schema: OneCDocumentSchema, write: upsertDocumentRecord },
} as const;

const MS_PER_DAY = 86_400_000;

export async function replayPendingRecords(
  db: PrismaClient,
  entity: CursorEntity,
  opts: { now: Date; maxAttempts?: number; maxAgeDays?: number }
): Promise<ReplayResult> {
  const maxAttempts = opts.maxAttempts ?? oneCPendingMaxAttempts();
  const maxAgeDays = opts.maxAgeDays ?? oneCPendingMaxAgeDays();
  const { schema, write } = DISPATCH[entity];
  const rows = await db.oneCPendingRecord.findMany({
    where: { entity, status: 'pending' },
    orderBy: { firstSeenAt: 'asc' },
    take: 500,
  });

  let resolved = 0, deadLettered = 0, stillPending = 0;
  for (const row of rows) {
    const parsed = schema.safeParse(row.dto);
    const attempts = row.attempts + 1;
    const ageMs = opts.now.getTime() - new Date(row.firstSeenAt).getTime();
    const overAge = ageMs >= maxAgeDays * MS_PER_DAY;

    if (!parsed.success) {
      // Stored DTO no longer validates — cannot replay; dead-letter it.
      await db.oneCPendingRecord.update({ where: { id: row.id }, data: { attempts, status: 'dead', reason: 'invalid_stored_dto' } });
      deadLettered++; continue;
    }

    const summary = emptySummary();
    let reason = row.reason;
    try {
      // notify:true — a payment that finally lands should still notify the org belatedly.
      await write(db, parsed.data as never, summary, { mode: 'live', notify: true });
    } catch (err) {
      reason = err instanceof Error ? err.message.slice(0, 200) : 'replay_threw';
    }

    if (summary.created + summary.updated > 0) {
      await db.oneCPendingRecord.delete({ where: { id: row.id } });
      resolved++; continue;
    }

    const lastSkip = summary.skips.at(-1);
    if (lastSkip) reason = lastSkip.reason;
    const permanent = lastSkip ? !isTransientSkip(lastSkip.reason) : true;
    const dead = permanent || attempts >= maxAttempts || overAge;
    await db.oneCPendingRecord.update({
      where: { id: row.id },
      data: dead ? { attempts, status: 'dead', reason } : { attempts, reason },
    });
    if (dead) deadLettered++; else stillPending++;
  }
  return { resolved, deadLettered, stillPending };
}
```

> `now` is injected (not `new Date()` inside) so tests are deterministic and the module stays pure — pass `new Date()` from the caller (the processor).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/oneCSync.pending.unit.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/oneCSync/pending.ts src/__tests__/oneCSync.pending.unit.test.ts
git commit -m "feat(1c): replay pending records through idempotent writers with dead-letter"
```

---

## Task 6: Wire capture + replay into the four sync processors

Each pull processor, in `live` mode, after `advanceCursor`: (a) captures this batch's transient skips, (b) replays this entity's pending backlog. Shadow mode does neither (it writes nothing). Wrap both in try/catch and log-and-swallow so a pending-store hiccup never fails the main pull (§3 graceful degrade).

**Files:**
- Modify: `src/worker/processors/sync-payments.ts` (and identically `sync-orders.ts`, `sync-documents.ts`, `sync-organizations.ts`)
- Modify: `src/__tests__/worker.sync-payments.*` (the existing per-processor test files)

- [ ] **Step 1: Write the failing test** — assert capture+replay run in live mode. Add to the existing payments processor test (e.g. `src/__tests__/worker.sync-payments.shadow.test.ts` or the integration test). Unit-level example with mocked pending module:

```ts
// In the existing sync-payments test file, add a mock for the pending module:
const { capturePendingSkips, replayPendingRecords } = vi.hoisted(() => ({
  capturePendingSkips: vi.fn().mockResolvedValue(undefined),
  replayPendingRecords: vi.fn().mockResolvedValue({ resolved: 0, deadLettered: 0, stillPending: 0 }),
}));
vi.mock('@/lib/services/oneCSync/pending', () => ({ capturePendingSkips, replayPendingRecords, isTransientSkip: () => true }));

it('captures skips and replays pending backlog in live mode', async () => {
  process.env.ONE_C_MODE = 'live';
  // ...existing live-mode db mock that yields at least one record...
  await syncPaymentsProcessor(job, dbLiveMock);
  expect(capturePendingSkips).toHaveBeenCalledWith(dbLiveMock, 'payment', expect.any(Array), expect.any(Function), expect.any(Object));
  expect(replayPendingRecords).toHaveBeenCalledWith(dbLiveMock, 'payment', expect.objectContaining({ now: expect.any(Date) }));
});

it('does NOT capture/replay in shadow mode', async () => {
  process.env.ONE_C_MODE = 'shadow';
  await syncPaymentsProcessor(job, dbShadowMock);
  expect(capturePendingSkips).not.toHaveBeenCalled();
  expect(replayPendingRecords).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/worker.sync-payments.shadow.test.ts`
Expected: FAIL — capture/replay never called (processor doesn't call them yet).

- [ ] **Step 3: Write minimal implementation** — in `sync-payments.ts`, after the `advanceCursor` line (line 42), add:

```ts
// import at top:
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';

// after: if (mode === 'live') await advanceCursor(db, 'payment', maxUpdatedAt);
if (mode === 'live') {
  // Capture out-of-order skips and replay the backlog so nothing is lost when a
  // dependency (org/order) appears later. Best-effort: never fail the pull on this.
  try {
    await capturePendingSkips(db, 'payment', raw, (dto) => (dto as OneCPaymentDto).externalId, summary);
    await replayPendingRecords(db, 'payment', { now: new Date() });
  } catch (e) {
    console.warn('[sync-payments] pending capture/replay failed', e);
  }
}
```

Repeat verbatim (adjusting entity string `'order'|'document'|'organization'` and the DTO cast) in the other three processors, after each one's `advanceCursor` call.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --mode=unit src/__tests__/worker.sync-payments.shadow.test.ts src/__tests__/worker.sync-orders.shadow.test.ts src/__tests__/worker.sync-documents.shadow.test.ts src/__tests__/worker.sync-organizations.shadow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/processors/sync-*.ts src/__tests__/worker.sync-*.shadow.test.ts
git commit -m "feat(1c): wire capture+replay into the four sync processors (live-only)"
```

---

## Task 7: Alert on dead-lettered records (loss is loud, never silent)

A dead-lettered record is a permanently-lost inbound row — the whole point is that this is now *visible*. Surface the count via the existing monitoring/alert pass.

**Files:**
- Modify: `src/lib/monitoring/thresholds.ts` (or the evaluate module — match the existing alert-definition pattern)
- Modify: `src/__tests__/monitoring.thresholds.test.ts`

- [ ] **Step 1: Write the failing test** — assert a dead-letter count above 0 produces a `warn`/`alert` threshold breach. Mirror the existing threshold-test style in `monitoring.thresholds.test.ts`:

```ts
it('flags 1C dead-lettered pending records as an alert', () => {
  expect(evaluateOneCDeadLetters(0)).toBe('ok');
  expect(evaluateOneCDeadLetters(1)).toBe('alert');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --mode=unit src/__tests__/monitoring.thresholds.test.ts`
Expected: FAIL — `evaluateOneCDeadLetters` not defined.

- [ ] **Step 3: Write minimal implementation** — add the pure threshold fn alongside the others in `thresholds.ts`:

```ts
/** Any dead-lettered 1C inbound record is a permanently-lost row → alert immediately. */
export function evaluateOneCDeadLetters(deadCount: number): 'ok' | 'alert' {
  return deadCount > 0 ? 'alert' : 'ok';
}
```

Then wire it into the alert-collection pass (the place that reads counts and emits alerts) with:

```ts
const deadCount = await db.oneCPendingRecord.count({ where: { status: 'dead' } });
// feed deadCount through evaluateOneCDeadLetters and the existing dedup/deliver path,
// matching how the other thresholds are collected in evaluate-alerts.
```

> Follow the exact alert-emission shape used by the neighbouring thresholds in the evaluate pass — do not hand-roll a new delivery channel (the alerting lib already dedups + delivers, per the alerting close-out).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --mode=unit src/__tests__/monitoring.thresholds.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/monitoring src/__tests__/monitoring.thresholds.test.ts
git commit -m "feat(1c): alert on dead-lettered pending records"
```

---

## Task 8: Integration — recovery, dead-letter, no-stall (live Postgres)

The decisive end-to-end proof. Requires the integration tier (`new PrismaClient(`) so it runs under `npm run test:integration` / the gate.

**Files:**
- Create: `src/__tests__/services.oneCSync.pending.integration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/services.oneCSync.pending.integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { capturePendingSkips, replayPendingRecords } from '@/lib/services/oneCSync/pending';
import { upsertPaymentRecord } from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

const db = new PrismaClient();

describe('1C pending store-and-replay (integration)', () => {
  beforeEach(async () => {
    await db.oneCPendingRecord.deleteMany();
    await db.payment.deleteMany();
    // ...seed a Partner + Company so an org can be created later...
  });

  it('payment skipped before its org is recovered once the org appears, not lost', async () => {
    // 1. Pull a payment for an org that does NOT exist yet → writer skips organization_not_found.
    const paymentDto = { externalId: 'PAY-X', amount: 1000, paidAt: '2026-06-01T00:00:00Z', isRefund: false, organizationInn: '7799999999', updatedAt: '2026-06-01T00:00:00Z' };
    const sum = emptySummary();
    await upsertPaymentRecord(db, paymentDto as never, sum, { mode: 'live', notify: false });
    expect(sum.skipped).toBe(1);

    // 2. Capture the skip.
    await capturePendingSkips(db, 'payment', [paymentDto], (d) => (d as { externalId: string }).externalId, sum);
    expect(await db.oneCPendingRecord.count({ where: { entity: 'payment', status: 'pending' } })).toBe(1);

    // 3. The org appears (synced later).
    // ...create the Organization with inn '7799999999' + companyId...

    // 4. Replay → the payment is now created and the pending row is gone.
    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-02T00:00:00Z') });
    expect(res.resolved).toBe(1);
    expect(await db.payment.count({ where: { externalId: 'PAY-X' } })).toBe(1);
    expect(await db.oneCPendingRecord.count()).toBe(0);
  });

  it('dead-letters after the attempt cap when the dependency never appears', async () => {
    const dto = { externalId: 'PAY-Y', amount: 1, paidAt: '2026-06-01T00:00:00Z', isRefund: false, organizationInn: '0000000000', updatedAt: '2026-06-01T00:00:00Z' };
    await db.oneCPendingRecord.create({ data: { entity: 'payment', externalId: 'PAY-Y', dto: dto as object, reason: 'organization_not_found', attempts: 49 } });
    const res = await replayPendingRecords(db, 'payment', { now: new Date('2026-06-02T00:00:00Z'), maxAttempts: 50, maxAgeDays: 7 });
    expect(res.deadLettered).toBe(1);
    expect((await db.oneCPendingRecord.findFirstOrThrow({ where: { externalId: 'PAY-Y' } })).status).toBe('dead');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- src/__tests__/services.oneCSync.pending.integration.test.ts` (needs live Postgres; or `npm run gate`)
Expected: FAIL initially (fill in the seed TODOs marked `...`), then drive to green.

- [ ] **Step 3: Fill the seed blanks and make it pass**

Complete the `beforeEach` seed and the org-creation step using the existing integration seed helpers (see `services.partner.*` integration tests for the Partner/Company/Organization creation pattern). No production code should be needed — if a test needs new production behavior, that is a gap to fix in Tasks 1–7.

- [ ] **Step 4: Run to verify green**

Run: `npm run test:integration -- src/__tests__/services.oneCSync.pending.integration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/services.oneCSync.pending.integration.test.ts
git commit -m "test(1c): integration — pending recovery + dead-letter + no cursor stall"
```

---

## Task 9: Full-suite gate + close-out

- [ ] **Step 1: Run the worker processor-coverage guardrail** — `replayPendingRecords` does not add a queue processor, so no new guardrail entry is needed; confirm the guardrail still passes.

Run: `npx vitest run --mode=unit src/__tests__/worker.processor-coverage.guardrail.test.ts`
Expected: PASS.

- [ ] **Step 2: Full local gate**

Run: `npm run typecheck && npm run lint && npm run test:unit` then `npm run gate` (Docker integration).
Expected: all green.

- [ ] **Step 3: Write the close-out** — `docs/superpowers/plans/2026-06-29-1c-cursor-skipped-record-loss-DONE.md` (per §8), recording what shipped vs the spec's Option A/B and that store-and-replay was chosen because the adapter is bulk-pull only.

- [ ] **Step 4: Commit + open PR**

```bash
git add docs/superpowers/plans/2026-06-29-1c-cursor-skipped-record-loss-DONE.md
git commit -m "docs(1c): close-out — cursor skipped-record loss fixed via store-and-replay"
```

---

## Self-Review

**Spec coverage:** Problem (§1) → Tasks 3,5,6 (capture+replay so out-of-order rows are not lost). No-stall requirement (§2) → cursor logic is untouched; Task 6 adds replay *after* `advanceCursor`. Taxonomy (§3) → Task 2 (`isTransientSkip`). Options (§4) → Architecture note: store-and-replay supersedes A/B because the adapter is bulk-pull only (Task-0 finding); dead-letter cap = Option B's escape hatch realised via attempts/age. Test strategy (§5) → Tasks 5 (unit lifecycle), 8 (integration recovery + dead-letter + no-stall). Open question #1 (adapter fetch-by-externalId) → **resolved**: not supported, replay-stored-DTO used instead. Open #2 (cap) → Task 4 (`ONE_C_PENDING_MAX_ATTEMPTS`/`_AGE_DAYS`). Open #3 (alert) → Task 7.

**Placeholder scan:** The only intentional blanks are the integration-test seed (`...`) in Task 8, explicitly called out as "fill using existing seed helpers"; every production-code step has complete code.

**Type consistency:** `CursorEntity` (Task 3) reused in Tasks 5–6; `capturePendingSkips`/`replayPendingRecords` signatures defined in Tasks 3/5 match the calls in Task 6; `OneCPendingRecord` field names (Task 1) match the Prisma calls throughout.
