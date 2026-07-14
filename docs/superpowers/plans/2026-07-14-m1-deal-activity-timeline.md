# M1 — Единая лента активности в карточке сделки: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать все коммуникации сделки (WhatsApp/Telegram/Max/почта/звонки/комментарии/внутренние заметки/смены статуса) в одну мессенджер-хронологию в карточке заказа менеджера, с ответом в канал, внутренними заметками (клиент не видит) и click-to-call.

**Architecture:** Подход A — read-агрегатор `getDealActivity()` за сервисным швом (без хранимой таблицы активности; §2 спеки). Три аддитивные правки схемы: `DealNote` (staff-only заметки, отдельная таблица), `Call.initiatedByUserId` (атрибуция click-to-call), `InboundMessage.sentAt` (хронология по времени провайдера). Реюз существующего: гард `getOrder` (C8/teamMode), `replyInboundAction`/`replyToInbound`, `POST /api/comments`, антивирус presigned-URL, Mango-адаптер. Новое: метод адаптера `initiateCallback` + сервис `initiateOutboundCall` + два server-action'а. UI — клиентский островок `DealActivityThread` в существующей `ManagerOrderDetailView`.

**Tech Stack:** Next.js 15 (App Router, RSC + server-actions), React 19, TypeScript strict, Prisma 5 + PostgreSQL, Vitest (unit+integration, `fileParallelism:false`), примитивы `src/components/ui/`.

**Спека:** [docs/superpowers/specs/2026-07-14-m1-deal-activity-timeline-design.md](../specs/2026-07-14-m1-deal-activity-timeline-design.md).

**Инварианты репозитория (соблюдать в каждой задаче):** Result-контракт §3; defense-in-depth §4 (гард всегда прокидывает `teamMode`); флаги §5 (поведенческие `inbound_messaging`/`telephony_mango`, нового флага НЕ вводим); журнал ПДн §12 (новая точка чтения → контекст + `recordPiiAccess`); логирование только через `@/lib/logging`; 100% coverage §6; узкие Prisma-селекты §13.

---

## Карта файлов

**Создаём:**
- `src/lib/services/manager/dealActivity.ts` — агрегатор `getDealActivity` + тип `ActivityItem`.
- `src/lib/services/manager/dealNotes.ts` — `addDealNote` (сервис Result-контракта).
- `src/lib/services/telephony/initiateCall.ts` — `initiateOutboundCall` (сервис).
- `src/server-actions/deal-activity.ts` — `addDealNoteAction`, `initiateCallAction`.
- `src/components/manager/deal-activity/deal-activity-thread.tsx` — клиентский тред + композер.
- `src/components/manager/deal-activity/activity-item.tsx` — презентация одного элемента (пузырь/чип/заметка).
- Тесты: `src/__tests__/services.deal-activity.unit.test.ts`, `services.deal-notes.unit.test.ts`, `services.initiate-call.unit.test.ts`, `server-actions.deal-activity.test.ts`, `components.deal-activity-thread.test.tsx`, `services.deal-activity.idor.integration.test.ts`.

**Модифицируем:**
- `prisma/schema.prisma` — модель `DealNote`, `Call.initiatedByUserId`, `InboundMessage.sentAt`, back-relations на `Order`/`User`.
- `src/lib/pii/contexts.ts` — контексты `deal_activity_inbound`, `deal_activity_calls`.
- `src/lib/telephony/mango/index.ts` — порт `MangoAdapter.initiateCallback`.
- `src/lib/telephony/mango/adapter-fake.ts`, `adapter-rest.ts` — реализация `initiateCallback`.
- `src/components/manager/manager-order-detail-view.tsx` — секция «Активность».
- `src/app/manager/orders/[id]/page.tsx` — загрузка `getDealActivity` + проброс флагов.

---

## Task 1: Схема — DealNote, Call.initiatedByUserId, InboundMessage.sentAt

**Files:**
- Modify: `prisma/schema.prisma`
- Create (авто): `prisma/migrations/<ts>_m1_deal_activity/migration.sql`

- [ ] **Step 1: Добавить back-relations и поля в существующие модели**

В `prisma/schema.prisma`, в модель `Order` (после строки `tasks Task[] @relation("TaskLinkedOrder")`) добавить:
```prisma
  dealNotes          DealNote[]                @relation("OrderDealNotes")
```
В модель `Call` (после `resolvedUserId String?`) добавить:
```prisma
  initiatedByUserId   String?
  initiatedBy         User?    @relation("CallInitiator", fields: [initiatedByUserId], references: [id])
```
В модель `InboundMessage` (после `createdAt DateTime @default(now())`) добавить:
```prisma
  sentAt         DateTime?
```
В модель `User` (в блок relations, рядом с `calls Call[] @relation("UserCalls")`) добавить:
```prisma
  callsInitiated   Call[]     @relation("CallInitiator")
  dealNotesAuthored DealNote[] @relation("DealNoteAuthor")
```

- [ ] **Step 2: Добавить модель DealNote**

В конец `prisma/schema.prisma`:
```prisma
/// M1 (спека 2026-07-14): внутренняя заметка по сделке (staff-only). Отдельная
/// таблица, а не флаг на Comment — у заметки НЕТ клиентского пути чтения, поэтому
/// «клиент не видит» держится конструкцией (CLAUDE.md §5). Company-scope — через order.
model DealNote {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  orderId   String
  order     Order    @relation("OrderDealNotes", fields: [orderId], references: [id], onDelete: Cascade)
  authorId  String
  author    User     @relation("DealNoteAuthor", fields: [authorId], references: [id])
  body      String

  @@index([orderId, createdAt])
  @@index([authorId])
}
```

- [ ] **Step 3: Сгенерировать клиент и миграцию**

Run: `npm run prisma:generate`
Затем: `npm run prisma:migrate -- --name m1_deal_activity`
Expected: миграция создана, применена к локальной БД без ошибок.

- [ ] **Step 4: Проверить типы и статус миграций**

Run: `npm run typecheck && npx prisma migrate status`
Expected: typecheck PASS; `Database schema is up to date!`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(m1): schema — DealNote, Call.initiatedByUserId, InboundMessage.sentAt"
```

---

## Task 2: Сервис `getDealActivity` + PII-контексты

**Files:**
- Modify: `src/lib/pii/contexts.ts`
- Create: `src/lib/services/manager/dealActivity.ts`
- Test: `src/__tests__/services.deal-activity.unit.test.ts`

> PII-guardrail `pii.capture-coverage` требует, чтобы `callSite` контекста реально вызывал `recordPiiAccess`. Поэтому контексты и сервис коммитятся **вместе** (эта задача).

- [ ] **Step 1: Написать падающий unit-тест агрегатора**

Создать `src/__tests__/services.deal-activity.unit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordPiiAccessMany } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  recordPiiAccessMany: vi.fn()
}));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccessMany, recordPiiAccess: vi.fn() }));

import { getDealActivity } from '@/lib/services/manager/dealActivity';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;

function fakePrisma(over: Record<string, unknown> = {}) {
  const base = {
    orderThread: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]) },
    call: { findMany: vi.fn().mockResolvedValue([]) },
    dealNote: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) }
  };
  return { ...base, ...over } as never;
}

beforeEach(() => vi.clearAllMocks());

it('returns not_found when order is not visible', async () => {
  getOrder.mockResolvedValue(null);
  const res = await getDealActivity(fakePrisma(), session, 'o1', { view: 'all' });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('merges sources ascending by unified `at`, using inbound.sentAt over createdAt', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    inboundMessage: { findMany: vi.fn().mockResolvedValue([
      { id: 'in1', channel: 'whatsapp', senderDisplay: 'Пётр', body: 'привет',
        sentAt: new Date('2026-07-13T10:00:00Z'), createdAt: new Date('2026-07-13T10:05:00Z'),
        attachmentName: null }
    ]) },
    dealNote: { findMany: vi.fn().mockResolvedValue([
      { id: 'n1', body: 'скидка 5%', createdAt: new Date('2026-07-13T09:00:00Z'),
        author: { id: 'u1', name: 'Иванов' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.items.map((i) => i.kind)).toEqual(['note', 'message_in']); // 09:00 before 10:00
  expect(res.items[1].at).toEqual(new Date('2026-07-13T10:00:00Z')); // sentAt wins
});

it("view:'dialogue' excludes note/call/event", async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    dealNote: { findMany: vi.fn().mockResolvedValue([
      { id: 'n1', body: 'x', createdAt: new Date(), author: { id: 'u1', name: 'И' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'dialogue' });
  expect(res.ok && res.items.length).toBe(0);
});

it('records PII access for inbound + calls (two contexts)', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    inboundMessage: { findMany: vi.fn().mockResolvedValue([
      { id: 'in1', channel: 'email', senderDisplay: null, body: 'hi', sentAt: null,
        createdAt: new Date(), attachmentName: null }
    ]) },
    call: { findMany: vi.fn().mockResolvedValue([
      { id: 'ca1', direction: 'inbound', callerNumber: '+70000000000', durationSec: 10,
        startedAt: new Date(), createdAt: new Date(), recordingScanStatus: 'clean',
        recordingPath: 'x', initiatedBy: null }
    ]) }
  });
  await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(recordPiiAccessMany).toHaveBeenCalledOnce();
  const argsList = recordPiiAccessMany.mock.calls[0][1];
  expect(argsList.map((a: { context: string }) => a.context).sort())
    .toEqual(['deal_activity_calls', 'deal_activity_inbound']);
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run src/__tests__/services.deal-activity.unit.test.ts`
Expected: FAIL (`getDealActivity` не существует).

- [ ] **Step 3: Добавить PII-контексты**

В `src/lib/pii/contexts.ts`, в объект `PII_CONTEXTS` (после `calls_list`):
```ts
  deal_activity_inbound: { subjectType: 'inbound_sender', action: 'list', labelRu: 'Активность сделки: входящие', callSite: 'src/lib/services/manager/dealActivity.ts' },
  deal_activity_calls: { subjectType: 'caller', action: 'list', labelRu: 'Активность сделки: звонки', callSite: 'src/lib/services/manager/dealActivity.ts' },
```

- [ ] **Step 4: Реализовать `getDealActivity`**

Создать `src/lib/services/manager/dealActivity.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordPiiAccessMany, type PiiAccessArgs } from '@/lib/pii/record';

export type ActivityView = 'dialogue' | 'all';

export type ActivityItem =
  | { kind: 'message_in'; id: string; at: Date; channel: string; sender: string; body: string; attachmentName: string | null }
  | { kind: 'message_out'; id: string; at: Date; author: string; body: string }
  | { kind: 'comment'; id: string; at: Date; author: string; body: string }
  | { kind: 'call'; id: string; at: Date; direction: string; number: string; durationSec: number | null; recordingReady: boolean; initiator: string | null }
  | { kind: 'note'; id: string; at: Date; author: string; body: string }
  | { kind: 'event'; id: string; at: Date; label: string };

export type GetDealActivityResult =
  | { ok: true; items: ActivityItem[] }
  | { ok: false; error: 'not_found' };

const DIALOGUE_KINDS = new Set(['message_in', 'message_out', 'comment']);

export async function getDealActivity(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string,
  opts: { view: ActivityView }
): Promise<GetDealActivityResult> {
  // Гард C8/teamMode/leader — переиспользуем существующий (CLAUDE.md §4).
  const order = await getOrder(prisma, session, orderId);
  if (!order) return { ok: false, error: 'not_found' };

  const threads = await prisma.orderThread.findMany({
    where: { orderId },
    select: { id: true }
  });
  const threadIds = threads.map((t) => t.id);

  const [comments, messages, inbound, calls, notes, events] = await Promise.all([
    prisma.comment.findMany({
      where: { orderId },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } },
      orderBy: { createdAt: 'asc' }
    }),
    threadIds.length
      ? prisma.message.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, body: true, createdAt: true, author: { select: { name: true } } }
        })
      : Promise.resolve([]),
    threadIds.length
      ? prisma.inboundMessage.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, channel: true, senderDisplay: true, senderRef: true, body: true, sentAt: true, createdAt: true, attachmentName: true }
        })
      : Promise.resolve([]),
    threadIds.length
      ? prisma.call.findMany({
          where: { threadId: { in: threadIds } },
          select: { id: true, direction: true, callerNumber: true, durationSec: true, startedAt: true, createdAt: true, recordingScanStatus: true, recordingPath: true, initiatedBy: { select: { name: true } } }
        })
      : Promise.resolve([]),
    prisma.dealNote.findMany({
      where: { orderId },
      select: { id: true, body: true, createdAt: true, author: { select: { name: true } } }
    }),
    prisma.auditLog.findMany({
      where: { entity: 'order', entityId: orderId, action: 'order_status_changed' },
      select: { id: true, createdAt: true, action: true }
    })
  ]);

  const items: ActivityItem[] = [
    ...comments.map((c): ActivityItem => ({ kind: 'comment', id: c.id, at: c.createdAt, author: c.author.name, body: c.body })),
    ...messages.map((m): ActivityItem => ({ kind: 'message_out', id: m.id, at: m.createdAt, author: m.author.name, body: m.body })),
    ...inbound.map((i): ActivityItem => ({ kind: 'message_in', id: i.id, at: i.sentAt ?? i.createdAt, channel: i.channel, sender: i.senderDisplay ?? i.senderRef, body: i.body, attachmentName: i.attachmentName })),
    ...calls.map((c): ActivityItem => ({ kind: 'call', id: c.id, at: c.startedAt ?? c.createdAt, direction: c.direction, number: c.callerNumber, durationSec: c.durationSec, recordingReady: c.recordingScanStatus === 'clean' && !!c.recordingPath, initiator: c.initiatedBy?.name ?? null })),
    ...notes.map((n): ActivityItem => ({ kind: 'note', id: n.id, at: n.createdAt, author: n.author.name, body: n.body })),
    ...events.map((e): ActivityItem => ({ kind: 'event', id: e.id, at: e.createdAt, label: 'Смена статуса заказа' }))
  ];

  items.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Журнал ПДн (§12): читаем контакты клиента (отправители/абоненты) → фиксируем.
  const piiArgs: PiiAccessArgs[] = [];
  if (inbound.length) piiArgs.push({ session, context: 'deal_activity_inbound', subjectIds: inbound.map((i) => i.id), meta: { take: inbound.length } });
  if (calls.length) piiArgs.push({ session, context: 'deal_activity_calls', subjectIds: calls.map((c) => c.id), meta: { take: calls.length } });
  if (piiArgs.length) await recordPiiAccessMany(prisma, piiArgs);

  const filtered = opts.view === 'dialogue' ? items.filter((i) => DIALOGUE_KINDS.has(i.kind)) : items;
  return { ok: true, items: filtered };
}
```

- [ ] **Step 5: Запустить тест и guardrail ПДн**

Run: `npx vitest run src/__tests__/services.deal-activity.unit.test.ts src/__tests__/pii.capture-coverage*`
Expected: PASS (агрегатор + полнота PII-контекстов).

- [ ] **Step 6: typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/lib/services/manager/dealActivity.ts src/lib/pii/contexts.ts src/__tests__/services.deal-activity.unit.test.ts
git commit -m "feat(m1): getDealActivity aggregator + PII contexts"
```

---

## Task 3: Внутренние заметки — `addDealNote` + `addDealNoteAction`

**Files:**
- Create: `src/lib/services/manager/dealNotes.ts`
- Create: `src/server-actions/deal-activity.ts` (первый action; click-to-call добавит Task 4)
- Test: `src/__tests__/services.deal-notes.unit.test.ts`

- [ ] **Step 1: Написать падающий unit-тест сервиса**

Создать `src/__tests__/services.deal-notes.unit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit } = vi.hoisted(() => ({ getOrder: vi.fn(), recordAudit: vi.fn() }));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

import { addDealNote } from '@/lib/services/manager/dealNotes';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;
beforeEach(() => vi.clearAllMocks());

it('rejects empty body as invalid', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = { dealNote: { create: vi.fn() } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: '  ' });
  expect(res).toEqual({ ok: false, error: 'invalid' });
});

it('returns not_found when order not visible', async () => {
  getOrder.mockResolvedValue(null);
  const prisma = { dealNote: { create: vi.fn() } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: 'hi' });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('creates note + audit on success', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const create = vi.fn().mockResolvedValue({ id: 'n1' });
  const prisma = { dealNote: { create } } as never;
  const res = await addDealNote(prisma, session, { orderId: 'o1', body: 'скидка 5%' });
  expect(res).toEqual({ ok: true, id: 'n1' });
  expect(create).toHaveBeenCalledWith({ data: { orderId: 'o1', authorId: 'u1', body: 'скидка 5%' }, select: { id: true } });
  expect(recordAudit).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Запустить — падает**

Run: `npx vitest run src/__tests__/services.deal-notes.unit.test.ts`
Expected: FAIL (`addDealNote` не существует).

- [ ] **Step 3: Реализовать сервис**

Создать `src/lib/services/manager/dealNotes.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { recordAudit } from '@/lib/auth/audit';

export type AddDealNoteResult =
  | { ok: true; id: string }
  | { ok: false; error: 'not_found' | 'invalid' };

export async function addDealNote(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; body: string }
): Promise<AddDealNoteResult> {
  const body = args.body.trim();
  if (!body) return { ok: false, error: 'invalid' };

  const order = await getOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'not_found' };

  const note = await prisma.dealNote.create({
    data: { orderId: args.orderId, authorId: session.sub, body },
    select: { id: true }
  });

  await recordAudit(prisma, {
    action: 'deal_note_created',
    entity: 'order',
    entityId: args.orderId,
    userId: session.sub
  });

  return { ok: true, id: note.id };
}
```

- [ ] **Step 4: Создать server-action**

Создать `src/server-actions/deal-activity.ts`:
```ts
'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { addDealNote, type AddDealNoteResult } from '@/lib/services/manager/dealNotes';

export async function addDealNoteAction(args: { orderId: string; body: string }): Promise<AddDealNoteResult> {
  const session = await requireManager();
  return addDealNote(prisma, session, args);
}
```

- [ ] **Step 5: Запустить тест + typecheck**

Run: `npx vitest run src/__tests__/services.deal-notes.unit.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/services/manager/dealNotes.ts src/server-actions/deal-activity.ts src/__tests__/services.deal-notes.unit.test.ts
git commit -m "feat(m1): internal deal notes (DealNote, staff-only)"
```

---

## Task 4: Click-to-call — Mango `initiateCallback` + сервис + action

**Files:**
- Modify: `src/lib/telephony/mango/index.ts` (порт), `adapter-fake.ts`, `adapter-rest.ts`
- Create: `src/lib/services/telephony/initiateCall.ts`
- Modify: `src/server-actions/deal-activity.ts` (добавить `initiateCallAction`)
- Test: `src/__tests__/services.initiate-call.unit.test.ts`

- [ ] **Step 1: Расширить порт адаптера + fake**

В `src/lib/telephony/mango/index.ts` в `interface MangoAdapter` добавить:
```ts
  initiateCallback(input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }>;
```
В `src/lib/telephony/mango/adapter-fake.ts` (в класс `FakeMangoAdapter`) добавить:
```ts
  async initiateCallback(input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }> {
    return { commandId: `fake-cmd-${input.toNumber}` };
  }
```
В `src/lib/telephony/mango/adapter-rest.ts` (в класс `RestMangoAdapter`) добавить (боевой вызов уточняется по докам Mango при подключении; шов — обязателен):
```ts
  async initiateCallback(_input: { fromInternal: string; toNumber: string }): Promise<{ commandId: string }> {
    // POST {MANGO_VPBX_BASE_URL}/commands/callback — подпись как в остальных вызовах.
    // Формат ответа (command_id) уточняется по докам Mango при боевом подключении.
    throw new Error('RestMangoAdapter.initiateCallback not wired yet (owner enables live callback)');
  }
```

- [ ] **Step 2: Написать падающий unit-тест сервиса**

Создать `src/__tests__/services.initiate-call.unit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit, writeSyncLog, isFeatureEnabled, initiateCallback } = vi.hoisted(() => ({
  getOrder: vi.fn(), recordAudit: vi.fn(), writeSyncLog: vi.fn(),
  isFeatureEnabled: vi.fn(), initiateCallback: vi.fn()
}));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/telephony/mango', () => ({ getMangoAdapter: () => ({ initiateCallback }) }));

import { initiateOutboundCall } from '@/lib/services/telephony/initiateCall';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;
beforeEach(() => { vi.clearAllMocks(); isFeatureEnabled.mockReturnValue(true); });

it('is disabled when telephony flag is off', async () => {
  isFeatureEnabled.mockReturnValue(false);
  const res = await initiateOutboundCall({} as never, session, { orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(res).toEqual({ ok: false, error: 'disabled' });
});

it('returns not_found when order not visible', async () => {
  getOrder.mockResolvedValue(null);
  const res = await initiateOutboundCall({} as never, session, { orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('creates outbound Call with initiator + audit + synclog', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockResolvedValue({ commandId: 'cmd9' });
  const create = vi.fn().mockResolvedValue({ id: 'ca1' });
  const findUnique = vi.fn().mockResolvedValue({ id: 'th1' });
  const prisma = { orderThread: { findUnique }, call: { create } } as never;
  const res = await initiateOutboundCall(prisma, session, { orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ direction: 'outbound', status: 'initiated', initiatedByUserId: 'u1', externalId: 'mango:cmd:cmd9' })
  }));
  expect(recordAudit).toHaveBeenCalledOnce();
  expect(writeSyncLog).toHaveBeenCalledWith(expect.objectContaining({ entity: 'call', direction: 'outbound' }));
});
```

- [ ] **Step 3: Запустить — падает**

Run: `npx vitest run src/__tests__/services.initiate-call.unit.test.ts`
Expected: FAIL (`initiateOutboundCall` не существует).

- [ ] **Step 4: Реализовать сервис**

Создать `src/lib/services/telephony/initiateCall.ts`:
```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder } from '@/lib/services/manager/orders';
import { getMangoAdapter } from '@/lib/telephony/mango';
import { recordAudit } from '@/lib/auth/audit';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { log } from '@/lib/logging';

export type InitiateCallResult =
  | { ok: true; callId: string }
  | { ok: false; error: 'disabled' | 'not_found' | 'call_failed' };

export async function initiateOutboundCall(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { orderId: string; toNumber: string; fromInternal: string }
): Promise<InitiateCallResult> {
  if (!isFeatureEnabled('telephony_mango')) return { ok: false, error: 'disabled' };

  const order = await getOrder(prisma, session, args.orderId);
  if (!order) return { ok: false, error: 'not_found' };

  let commandId: string;
  try {
    ({ commandId } = await getMangoAdapter().initiateCallback({ fromInternal: args.fromInternal, toNumber: args.toNumber }));
  } catch (err) {
    log.warn('[telephony/initiateOutboundCall] callback failed', { orderId: args.orderId, error: err instanceof Error ? err.message : String(err) });
    return { ok: false, error: 'call_failed' };
  }

  const thread = await prisma.orderThread.findUnique({
    where: { orderId_side: { orderId: args.orderId, side: 'org' } },
    select: { id: true }
  });

  const call = await prisma.call.create({
    data: {
      provider: 'mango',
      externalId: `mango:cmd:${commandId}`,
      direction: 'outbound',
      status: 'initiated',
      callerNumber: args.toNumber,
      initiatedByUserId: session.sub,
      resolvedOrgId: order.organizationId,
      companyId: order.companyId,
      threadId: thread?.id ?? null
    },
    select: { id: true }
  });

  await recordAudit(prisma, { action: 'call_initiated', entity: 'order', entityId: args.orderId, userId: session.sub });
  await writeSyncLog({ entity: 'call', direction: 'outbound', operation: 'create', status: 'success' });

  return { ok: true, callId: call.id };
}
```

- [ ] **Step 5: Добавить server-action `initiateCallAction`**

В `src/server-actions/deal-activity.ts` дописать:
```ts
import { initiateOutboundCall, type InitiateCallResult } from '@/lib/services/telephony/initiateCall';
import { notFoundIfDisabled } from '@/lib/featureFlags';

export async function initiateCallAction(args: { orderId: string; toNumber: string; fromInternal: string }): Promise<InitiateCallResult> {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return { ok: false, error: 'disabled' };
  const session = await requireManager();
  return initiateOutboundCall(prisma, session, args);
}
```

- [ ] **Step 6: Запустить тесты + typecheck**

Run: `npx vitest run src/__tests__/services.initiate-call.unit.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/telephony/mango src/lib/services/telephony/initiateCall.ts src/server-actions/deal-activity.ts src/__tests__/services.initiate-call.unit.test.ts
git commit -m "feat(m1): click-to-call (Mango initiateCallback + outbound Call)"
```

---

## Task 5: UI — `DealActivityThread` + интеграция в карточку сделки

**Files:**
- Create: `src/components/manager/deal-activity/activity-item.tsx`
- Create: `src/components/manager/deal-activity/deal-activity-thread.tsx`
- Modify: `src/components/manager/manager-order-detail-view.tsx`
- Modify: `src/app/manager/orders/[id]/page.tsx`
- Test: `src/__tests__/components.deal-activity-thread.test.tsx`

- [ ] **Step 1: Презентация одного элемента (`activity-item.tsx`)**

Создать `src/components/manager/deal-activity/activity-item.tsx` — чистый презентационный компонент по типу `ActivityItem` (см. Task 2): `message_in` → пузырь слева с бейджем канала; `message_out`/`comment` → пузырь справа; `call` → чип (направление, длительность, «▶ запись» если `recordingReady`); `note` → блок с меткой «клиент не видит»; `event` → центрированный чип. Цвета — из примитивов/util, без инлайна brand-hex сверх необходимого (§13). Экспорт `ActivityItemView({ item }: { item: ActivityItem })`.

- [ ] **Step 2: Написать падающий component-тест**

Создать `src/__tests__/components.deal-activity-thread.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ActivityItem } from '@/lib/services/manager/dealActivity';
import { DealActivityThread } from '@/components/manager/deal-activity/deal-activity-thread';

vi.mock('@/server-actions/deal-activity', () => ({ addDealNoteAction: vi.fn(), initiateCallAction: vi.fn() }));

const items: ActivityItem[] = [
  { kind: 'message_in', id: 'in1', at: new Date('2026-07-13T10:00:00Z'), channel: 'whatsapp', sender: 'Пётр', body: 'привет', attachmentName: null },
  { kind: 'note', id: 'n1', at: new Date('2026-07-13T11:00:00Z'), author: 'Иванов', body: 'скидка 5%' }
];

it('renders a note with the "клиент не видит" marker', () => {
  render(<DealActivityThread orderId="o1" items={items} inboundEnabled telephonyEnabled />);
  expect(screen.getByText(/скидка 5%/)).toBeInTheDocument();
  expect(screen.getByText(/клиент не видит/i)).toBeInTheDocument();
});

it('hides the call button when telephony disabled', () => {
  render(<DealActivityThread orderId="o1" items={items} inboundEnabled telephonyEnabled={false} />);
  expect(screen.queryByRole('button', { name: /позвонить/i })).toBeNull();
});
```

- [ ] **Step 3: Запустить — падает**

Run: `npx vitest run src/__tests__/components.deal-activity-thread.test.tsx`
Expected: FAIL (`DealActivityThread` не существует).

- [ ] **Step 4: Реализовать `deal-activity-thread.tsx`**

Создать `src/components/manager/deal-activity/deal-activity-thread.tsx` — `'use client'`. Props: `{ orderId: string; items: ActivityItem[]; inboundEnabled: boolean; telephonyEnabled: boolean }`. Рендерит: фильтр «Диалог / Вся активность» (клиентский `useState`), список `ActivityItemView` (снизу — свежее, автоскролл), композер с переключателем «Клиенту / 🔒 Заметка» + (если `telephonyEnabled`) кнопка «Позвонить» (вызывает `initiateCallAction`), заметка через `addDealNoteAction`. Строки каналов и кнопка «Позвонить» скрыты при `!inboundEnabled`/`!telephonyEnabled` соответственно. Использовать `toast` для фидбека и `useFormAction`/`Button`/`Textarea` из `ui/`.

- [ ] **Step 5: Прогонять данные в карточку сделки**

В `src/app/manager/orders/[id]/page.tsx` добавить загрузку активности и флагов и передать в view:
```ts
import { getDealActivity } from '@/lib/services/manager/dealActivity';
import { isFeatureEnabled } from '@/lib/featureFlags';
// ...внутри компонента, после loadManagerOrderDetail:
const activity = await getDealActivity(prisma, session, id, { view: 'all' });
const activityItems = activity.ok ? activity.items : [];
const inboundEnabled = isFeatureEnabled('inbound_messaging');
const telephonyEnabled = isFeatureEnabled('telephony_mango');
```
Передать `activityItems`, `inboundEnabled`, `telephonyEnabled` в `<ManagerOrderDetailView ... />`.

- [ ] **Step 6: Секция «Активность» в `manager-order-detail-view.tsx`**

В `src/components/manager/manager-order-detail-view.tsx` принять новые props и отрендерить секцию «Активность» (заголовок + `<DealActivityThread ... />`) над блоком read-only комментариев.

- [ ] **Step 7: Запустить тесты + typecheck + lint**

Run: `npx vitest run src/__tests__/components.deal-activity-thread.test.tsx && npm run typecheck && npm run lint`
Expected: PASS, 0 warnings.

- [ ] **Step 8: Commit**

```bash
git add src/components/manager/deal-activity src/components/manager/manager-order-detail-view.tsx "src/app/manager/orders/[id]/page.tsx" src/__tests__/components.deal-activity-thread.test.tsx
git commit -m "feat(m1): deal activity thread UI + click-to-call button"
```

---

## Task 6: Интеграционные регрессы (IDOR/C8, клиент-невидимость заметок, flag-off) + close-out

**Files:**
- Test: `src/__tests__/services.deal-activity.idor.integration.test.ts`
- Create: `docs/superpowers/plans/2026-07-14-m1-deal-activity-timeline-DONE.md`

- [ ] **Step 1: Написать integration-тест изоляции**

Создать `src/__tests__/services.deal-activity.idor.integration.test.ts` (`new PrismaClient()` → авто-integration-режим §6). Сценарии, каждый против живой БД:
- менеджер компании A вызывает `getDealActivity` по заказу компании B → `{ ok: false, error: 'not_found' }` (переиспользованный `getOrder`-гард);
- `DealNote`, созданная `addDealNote`, **не** появляется ни в одном клиентском пути чтения (проверить, что модель не включена в org/partner-сервисы карточки — отсутствие клиентского селектора `dealNote`);
- `getDealActivity` с `view:'dialogue'` не возвращает `note`/`call`;
- при наличии inbound/calls пишется `PiiAccessEvent` (2 строки с контекстами `deal_activity_inbound`/`deal_activity_calls`).

- [ ] **Step 2: Запустить integration-слой**

Run: `npm run gate` (или `npm run test:integration` при живом Postgres)
Expected: новый тест PASS; worker-guardrail не затронут.

- [ ] **Step 3: Полный прогон покрытия**

Run: `npm run test:coverage`
Expected: 100% на затронутых glob'ах (`src/lib/services/**`, `src/server-actions/**`, `src/components/**`, `src/app/**/*.tsx`); при пробелах — дописать точечные тесты (напр. `event`-ветку, email-`message_in` без вложения, flag-off-ветку сервиса).

- [ ] **Step 4: Финальные гейты**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: всё зелёное.

- [ ] **Step 5: Close-out + commit**

Создать `docs/superpowers/plans/2026-07-14-m1-deal-activity-timeline-DONE.md` (что отгружено vs план; отложенное — подходы B/C, @упоминания, атрибуция→M2, боевой Mango callback, deal-level исходящее сообщение без прежнего inbound). Затем:
```bash
git add src/__tests__/services.deal-activity.idor.integration.test.ts docs/superpowers/plans/2026-07-14-m1-deal-activity-timeline-DONE.md
git commit -m "test(m1): IDOR/C8 + client-invisibility regressions; M1 close-out"
```

---

## Порядок и зависимости

Task 1 (схема) — фундамент. Task 2/3/4 независимы между собой (все зависят от Task 1). Task 5 (UI) зависит от 2/3/4. Task 6 — финальный регресс/покрытие. Рекомендуемая последовательность: 1 → 2 → 3 → 4 → 5 → 6.

## Проверка спеки против плана (self-review)

- **§2.1 схема (3 правки)** → Task 1 ✅.
- **§2.2 `getDealActivity` (единый `at`, view-фильтр, C8/teamMode-скоуп) + ПДн** → Task 2 ✅ (ПДн реализован как 2 контекста `inbound_sender`+`caller` через `recordPiiAccessMany` — уточнение к спеке §2.2.5, где ошибочно был `subjectType:'order'`: такого типа в `PiiSubjectType` нет, поэтому зеркалим паттерн карточки организации `org_card_inbound`/`org_card_calls`).
- **§2.3 ответ (реюз) / заметка / click-to-call** → заметка Task 3, click-to-call Task 4; ответ в канал — реюз существующего `replyInboundAction` (в композере Task 5), клиентский комментарий — существующий `POST /api/comments`; **deal-level исходящее сообщение в канал без прежнего inbound отложено** (нужен номер/контакт → M2), помечено в §5 спеки и close-out.
- **§2.4 флаги без нового** → Task 4/5 (поведенческие гейты `inbound_messaging`/`telephony_mango`) ✅.
- **§2.5 UI мессенджер** → Task 5 ✅.
- **§3 инварианты приёмки** → Task 6 (IDOR/C8, клиент-невидимость заметок, flag-off, ПДн, 100% coverage) ✅.
