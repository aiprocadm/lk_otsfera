# T1 — Единый контракт ингестии 1С: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Свести Excel- и API-ингестию 1С к одному контракту (`OneC*Schema`), одному completeness-gate и одному writer'у; Excel становится `FileOneCAdapter`, расходящаяся ветка `import/commit-import.ts` удаляется. Закрывает F1/F3/F4/F5/F6/F7.

**Architecture:** Адаптеры-источники (`RestOneCAdapter`, новый `FileOneCAdapter`, `FakeOneCAdapter`) производят одинаковые `OneC*Dto`. Общие writer'ы (`oneCSync/writers.ts`, выделенные из worker-процессоров) делают upsert; их зовут и worker (unscoped, notify), и Excel-загрузка (scoped, dry-run preview через `mode:'shadow'`). Контракт (zod) отсекает неполные записи в карантин.

**Tech Stack:** TypeScript strict, zod, Prisma, BullMQ, ExcelJS, Vitest. Сервисный Result-контракт (CLAUDE.md §3); mock-паттерн `vi.hoisted` (§6).

**Spec:** [2026-06-13-t1-ingestion-contract-design.md](../specs/2026-06-13-t1-ingestion-contract-design.md)

---

## File Structure

**Create:**
- `src/lib/services/oneCSync/translate.ts` — RU-строки статусов 1С → enum (`financialStatus`/`executionStatus`), неизвестное → `{ ok:false }`.
- `src/lib/services/oneCSync/resolve-org.ts` — `resolveOrganizationRef(db, { externalId?, inn? })` → org или null, externalId-приоритет, ИНН-fallback, дополнение externalId.
- `src/lib/services/oneCSync/writers.ts` — `upsertOrgRecord/upsertOrderRecord/upsertPaymentRecord/upsertDocumentRecord(db, dto, sum, ctx)`, выделенные из процессоров.
- `src/lib/services/oneCSync/scope.ts` — перенос `importScope` + тип `ImportScope` (writers в oneCSync не должны импортировать из `import/`).
- `src/lib/services/oneCSync/adapter-file.ts` — `FileOneCAdapter implements OneCAdapter`, конструируется из буфера, парсит workbook и обогащает до полных DTO.
- `src/__tests__/oneCSync.translate.test.ts`, `oneCSync.resolve-org.test.ts`, `oneCSync.writers.test.ts`, `oneCSync.adapter-file.test.ts`, `import.unified.integration.test.ts` (live-PG паритет).

**Modify:**
- `src/lib/services/oneCSync/schemas.ts` — `OneCPaymentSchema`: `orderExternalId` → optional, добавить `organizationExternalId` optional, refine «хотя бы один».
- `src/lib/services/oneCSync/dto.ts` + `mappers.ts` — `PaymentUpsertInput` (org-level), `mapPaymentDto`.
- `src/lib/services/oneCSync/index.ts` — `export { FileOneCAdapter }`.
- `src/worker/processors/sync-orders.ts` / `sync-payments.ts` / `sync-organizations.ts` / `sync-documents.ts` — заменить inline-handler на `upsert*Record(...)`.
- `src/lib/services/import/index.ts` — переписать на `FileOneCAdapter` + `runRecordBatch` + writers; preview = `mode:'shadow'`, commit = `mode:'live'`; прокинуть scope; вернуть `BatchSummary`-отчёт.
- `src/lib/services/import/column-map.ts` — добавить опц. колонки `financialStatusRaw` (заказ) и `orderRef` (оплата).
- `src/server-actions/import.ts` — гард размера (≤20 МБ) + расширения `.xlsx` (F5).
- `src/components/import/import-form.tsx` — рендер `BatchSummary` вместо `ImportPlan`.
- `src/lib/services/leader/dashboard.ts` — F6: единый фильтр KPI.

**Delete:**
- `src/lib/services/import/commit-import.ts`, `payment-mapper.ts`, `validate.ts`, `types.ts`, `plan-import.ts` и `scope.ts` (перенесён в oneCSync).
- Тесты-дубли: `import.payment-mapper.test.ts`, `import.validate.test.ts`, `import.plan.test.ts`; переписать `import.contract.test.ts`, `server-actions.import.test.ts`.
- **Keep:** `parse-workbook.ts`, `column-map.ts` (+ их тесты) — их использует `FileOneCAdapter`.

---

## Phase A — Контракт и переводы (без смены поведения)

### Task 1: Слой перевода справочников статусов

**Files:** Create `src/lib/services/oneCSync/translate.ts`; Test `src/__tests__/oneCSync.translate.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { translateFinancialStatus, translateExecutionStatus } from '@/lib/services/oneCSync/translate';

describe('translateFinancialStatus', () => {
  it('maps known RU labels to enum', () => {
    expect(translateFinancialStatus('Оплачено')).toEqual({ ok: true, value: 'paid' });
    expect(translateFinancialStatus('Частично оплачено')).toEqual({ ok: true, value: 'partially_paid' });
    expect(translateFinancialStatus('Счёт выставлен')).toEqual({ ok: true, value: 'billed' });
  });
  it('is case/space-insensitive', () => {
    expect(translateFinancialStatus('  оплачено ')).toEqual({ ok: true, value: 'paid' });
  });
  it('returns not-ok for unknown', () => {
    expect(translateFinancialStatus('Марсианский статус')).toEqual({ ok: false });
  });
});
describe('translateExecutionStatus', () => {
  it('maps known labels', () => {
    expect(translateExecutionStatus('В работе')).toEqual({ ok: true, value: 'in_progress' });
    expect(translateExecutionStatus('Выполнен')).toEqual({ ok: true, value: 'completed' });
  });
});
```

- [ ] **Step 2: Run, verify fails** — `npm run test:unit -- oneCSync.translate` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import type { FinancialStatus, ExecutionStatus } from '@prisma/client';

type Tr<T> = { ok: true; value: T } | { ok: false };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/ё/g, 'е');

const FIN: Record<string, FinancialStatus> = {
  'не выставлен': 'not_billed', 'счет выставлен': 'billed', 'счет': 'billed',
  'частично оплачено': 'partially_paid', 'оплачено': 'paid', 'возврат': 'refunded',
};
const EXEC: Record<string, ExecutionStatus> = {
  'новый': 'pending', 'ожидает': 'pending', 'в работе': 'in_progress',
  'выполнен': 'completed', 'отменен': 'cancelled', 'приостановлен': 'on_hold',
};

export function translateFinancialStatus(raw: string): Tr<FinancialStatus> {
  const v = FIN[norm(raw)];
  return v ? { ok: true, value: v } : { ok: false };
}
export function translateExecutionStatus(raw: string): Tr<ExecutionStatus> {
  const v = EXEC[norm(raw)];
  return v ? { ok: true, value: v } : { ok: false };
}
```

- [ ] **Step 4: Run, verify passes** — `npm run test:unit -- oneCSync.translate` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(1c): status translation layer (RU→enum)"`

> Примечание: точные RU-значения уточняются по мере появления реальной выгрузки; неизвестное → `{ok:false}` (карантин в адаптере), не молчаливый дефолт. Маппинг — единственный источник правды для перевода (используется и T2).

### Task 2: Расширение контракта оплаты (org-level)

**Files:** Modify `schemas.ts`, `dto.ts`, `mappers.ts`; Test `src/__tests__/oneCSync.schemas.test.ts` (добавить кейсы)

- [ ] **Step 1: Failing test** (добавить в существующий describe)

```ts
import { OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';

it('payment accepts order-level ref', () => {
  expect(OneCPaymentSchema.safeParse({ externalId:'P1', orderExternalId:'O1', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(true);
});
it('payment accepts org-level ref (no order)', () => {
  expect(OneCPaymentSchema.safeParse({ externalId:'P2', organizationExternalId:'ORG1', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(true);
});
it('payment rejects when neither order nor org ref present', () => {
  expect(OneCPaymentSchema.safeParse({ externalId:'P3', amount:100, paidAt:'2026-04-01T00:00:00Z', isRefund:false, updatedAt:'2026-04-01T00:00:00Z' }).success).toBe(false);
});
```

- [ ] **Step 2: Run, verify fails** — `npm run test:unit -- oneCSync.schemas` → FAIL (org-less rejected / org-level missing field).

- [ ] **Step 3: Implement** — в `schemas.ts` заменить `OneCPaymentSchema`:

```ts
export const OneCPaymentSchema = z.object({
  externalId: z.string().min(1),
  orderExternalId: z.string().min(1).optional(),
  organizationExternalId: z.string().min(1).optional(),
  amount: z.number(),
  paidAt: isoDate,
  method: z.string().optional(),
  isRefund: z.boolean(),
  updatedAt: isoDate
}).refine((p) => !!p.orderExternalId || !!p.organizationExternalId, {
  message: 'payment requires orderExternalId or organizationExternalId'
});
```

В `mappers.ts` обновить `PaymentUpsertInput` и `mapPaymentDto`:

```ts
export type PaymentUpsertInput = {
  externalId: string;
  orderExternalId: string | null;
  organizationExternalId: string | null;
  amount: number; paidAt: Date; method: string | null; isRefund: boolean; updatedAt: Date;
};
export function mapPaymentDto(dto: OneCPaymentDto): PaymentUpsertInput {
  return {
    externalId: dto.externalId,
    orderExternalId: dto.orderExternalId ?? null,
    organizationExternalId: dto.organizationExternalId ?? null,
    amount: dto.amount, paidAt: new Date(dto.paidAt),
    method: dto.method ?? null, isRefund: dto.isRefund, updatedAt: new Date(dto.updatedAt)
  };
}
```

- [ ] **Step 4: Run, verify passes** — `npm run test:unit -- oneCSync.schemas oneCSync.mappers` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(1c): payment contract supports org-level (orderId optional)"`

### Task 3: Резолвер организации (externalId ∨ ИНН)

**Files:** Create `src/lib/services/oneCSync/resolve-org.ts`; Test `oneCSync.resolve-org.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { resolveOrganizationRef } from '@/lib/services/oneCSync/resolve-org';

function dbWith(orgs: any[]) {
  return {
    organization: {
      findFirst: vi.fn(async ({ where }: any) =>
        orgs.find(o => (where.externalId && o.externalId === where.externalId) || (where.inn && o.inn === where.inn)) ?? null),
      update: vi.fn(async () => ({})),
    },
  } as any;
}
describe('resolveOrganizationRef', () => {
  it('matches by externalId first', async () => {
    const db = dbWith([{ id:'a', externalId:'E1', inn:'77' }]);
    expect(await resolveOrganizationRef(db, { externalId:'E1' })).toMatchObject({ id:'a' });
  });
  it('falls back to inn and backfills externalId', async () => {
    const db = dbWith([{ id:'b', externalId:null, inn:'77' }]);
    const r = await resolveOrganizationRef(db, { externalId:'E2', inn:'77' });
    expect(r).toMatchObject({ id:'b' });
    expect(db.organization.update).toHaveBeenCalledWith({ where:{ id:'b' }, data:{ externalId:'E2' } });
  });
  it('returns null when nothing matches', async () => {
    expect(await resolveOrganizationRef(dbWith([]), { inn:'00' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement**

```ts
import type { PrismaClient } from '@prisma/client';

export type OrgRef = { externalId?: string | null; inn?: string | null };
export async function resolveOrganizationRef(db: PrismaClient, ref: OrgRef) {
  if (ref.externalId) {
    const byExt = await db.organization.findFirst({
      where: { externalId: ref.externalId }, select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byExt) return byExt;
  }
  if (ref.inn) {
    const byInn = await db.organization.findFirst({
      where: { inn: ref.inn }, select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byInn) {
      if (ref.externalId && !byInn.externalId) {
        await db.organization.update({ where: { id: byInn.id }, data: { externalId: ref.externalId } });
      }
      return byInn;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(1c): org resolver externalId∨inn with externalId backfill"`

---

## Phase B — Общий writer (поведение worker'а сохраняется 1:1)

### Task 4: Перенести `importScope` в oneCSync

**Files:** Create `src/lib/services/oneCSync/scope.ts` (копия текущего `import/scope.ts`); Modify `import/index.ts` импорт; затем Delete `import/scope.ts` в Task 11.

- [ ] **Step 1:** Создать `oneCSync/scope.ts` — дословно содержимое текущего `src/lib/services/import/scope.ts` (тип `ImportScope` + `importScope`).
- [ ] **Step 2:** Переключить `import/scope.test.ts` импорт на `@/lib/services/oneCSync/scope`; Run `npm run test:unit -- import.scope` → PASS.
- [ ] **Step 3: Commit** — `git commit -am "refactor(1c): move importScope into oneCSync (writers depend on it)"`

### Task 5: Writer `upsertOrderRecord` (extract из sync-orders)

**Files:** Create `src/lib/services/oneCSync/writers.ts`; Test `oneCSync.writers.test.ts`; Modify `src/worker/processors/sync-orders.ts`

- [ ] **Step 1: Failing test** — поведенческий паритет + scope:

```ts
// см. oneCSync.writers.test.ts: даёт db-моки, проверяет:
// - create ставит financialStatus/executionStatus/partnerId(org.partnerId)/companyId
// - mode:'shadow' не пишет, но считает sum.created
// - ctx.scope scoped + org не в allowedOrgIds → sum.skipped + reason 'out_of_scope'
// - ctx.notify=false → notifyOrgUsers не вызван
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement** — вынести тело хендлера из [sync-orders.ts:40-112](../../../src/worker/processors/sync-orders.ts) в `writers.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { OneCOrderDto, OneCPaymentDto, OneCOrgDto, OneCDocumentDto } from './dto';
import { mapOrderDto, mapPaymentDto, mapOrgDto, mapDocumentDto } from './mappers';
import { resolveOrganizationRef } from './resolve-org';
import type { BatchSummary } from './record-batch';
import type { OneCMode } from './config';
import type { ImportScope } from './scope';
import { notifyOrgUsers, notifyManagers } from '@/lib/notifications';

export type WriteCtx = { mode: OneCMode; notify: boolean; scope?: ImportScope; bump?: (iso: string) => void };
const live = (c: WriteCtx) => c.mode === 'live';
function orgWritable(scope: ImportScope | undefined, orgId: string, isNew: boolean): boolean {
  if (!scope || scope.unscoped) return true;
  if (isNew) return scope.mayCreateOrgs;       // plain manager не создаёт орг
  return scope.allowedOrgIds.includes(orgId);
}

export async function upsertOrderRecord(db: PrismaClient, dto: OneCOrderDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapOrderDto(dto);
  const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId });
  if (!org || !org.companyId) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }
  if (!orgWritable(ctx.scope, org.id, false)) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return; }

  const existing = await db.order.findUnique({ where: { externalId: input.externalId },
    select: { id: true, organizationId: true, financialStatus: true, orderNumber: true, title: true } });
  const ownedBy1C = {
    orderNumber: input.orderNumber, title: input.title, totalAmount: input.totalAmount, paidAmount: input.paidAmount,
    paidAt: input.paidAt, contractSignedAt: input.contractSignedAt, completedAt: input.completedAt, closedAt: input.closedAt,
    vatIncluded: input.vatIncluded, vatRate: input.vatRate, financialStatus: input.financialStatus,
    productMix: input.productMix, lastSyncedAt: new Date(),
  };
  if (existing) {
    if (live(ctx)) await db.order.update({ where: { id: existing.id },
      data: existing.organizationId === null ? { ...ownedBy1C, organizationId: org.id } : ownedBy1C });
    sum.updated++; ctx.bump?.(dto.updatedAt);
    const targetOrgId = existing.organizationId ?? org.id;
    if (ctx.notify && live(ctx) && targetOrgId && existing.financialStatus !== input.financialStatus) {
      await notifyOrgUsers(db, { organizationId: targetOrgId, type: 'order_status_changed', payload: {
        orderId: existing.id, orderNumber: existing.orderNumber, orderTitle: existing.title,
        dimension: 'financial', oldStatus: existing.financialStatus, newStatus: input.financialStatus } });
    }
  } else {
    if (!orgWritable(ctx.scope, org.id, false)) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return; }
    if (live(ctx)) await db.order.create({ data: { ...ownedBy1C, externalId: input.externalId,
      executionStatus: input.executionStatus, companyId: org.companyId, partnerId: org.partnerId, organizationId: org.id } });
    sum.created++; ctx.bump?.(dto.updatedAt);
  }
}
```

- [ ] **Step 4:** Переписать `sync-orders.ts` хендлер на вызов writer'а:

```ts
const summary = await runRecordBatch<OneCOrderDto>(raw, OneCOrderSchema, (d) => d.externalId,
  (dto, sum) => upsertOrderRecord(db, dto, sum, { mode, notify: true, bump }));
```

- [ ] **Step 5: Run** — `npm run test:unit -- oneCSync.writers worker.sync-orders.shadow` → PASS (shadow-тест процессора не меняется).
- [ ] **Step 6: Commit** — `git commit -am "refactor(1c): extract upsertOrderRecord; sync-orders uses it"`

### Task 6: Writer `upsertPaymentRecord` (order ∨ org-level)

**Files:** Modify `writers.ts`, `sync-payments.ts`; Test `oneCSync.writers.test.ts`

- [ ] **Step 1: Failing test** — оплата с `orderExternalId` линкуется к заказу (как сейчас); оплата только с `organizationExternalId` пишется org-level (`orderId:null`); отсутствие обоих не достигает writer'а (отсечено zod).

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement** — добавить в `writers.ts`, обобщив [sync-payments.ts:40-97](../../../src/worker/processors/sync-payments.ts):

```ts
export async function upsertPaymentRecord(db: PrismaClient, dto: OneCPaymentDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapPaymentDto(dto);
  let orderId: string | null = null;
  let organizationId: string | null = null;
  let order: { id: string; organizationId: string | null; orderNumber: string | null; title: string } | null = null;

  if (input.orderExternalId) {
    order = await db.order.findUnique({ where: { externalId: input.orderExternalId },
      select: { id: true, organizationId: true, orderNumber: true, title: true } });
    if (!order) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' }); return; }
    orderId = order.id; organizationId = order.organizationId;
  } else {
    const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId });
    if (!org) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }
    organizationId = org.id;
    if (!orgWritable(ctx.scope, org.id, false)) { sum.skipped++; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return; }
  }

  const existing = await db.payment.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  const updatable = { amount: input.amount, paidAt: input.paidAt, method: input.method, isRefund: input.isRefund };
  if (existing) {
    if (live(ctx)) await db.payment.update({ where: { id: existing.id }, data: updatable });
    sum.updated++; ctx.bump?.(dto.updatedAt);
  } else {
    if (live(ctx)) await db.payment.create({ data: { ...updatable, externalId: input.externalId, orderId, organizationId } });
    sum.created++; ctx.bump?.(dto.updatedAt);
    if (ctx.notify && live(ctx) && order && order.organizationId && !input.isRefund) {
      try { await notifyOrgUsers(db, { organizationId: order.organizationId, type: 'payment_received',
        payload: { orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title, amount: input.amount.toString(), paidAt: input.paidAt } }); }
      catch (err) { console.warn('[1c] payment notifyOrgUsers failed', err); }
    }
    if (ctx.notify && live(ctx) && order && !input.isRefund) {
      try { await notifyManagers(db, { orderId: order.id, type: 'order_marked_paid_by_1c',
        payload: { amount: Number(input.amount), paidAt: input.paidAt } }); }
      catch (err) { console.warn('[1c] payment notifyManagers failed', err); }
    }
  }
}
```

- [ ] **Step 4:** Переписать `sync-payments.ts` на `(dto, sum) => upsertPaymentRecord(db, dto, sum, { mode, notify: true, bump })`.
- [ ] **Step 5: Run** — `npm run test:unit -- oneCSync.writers worker.sync-payments.shadow` → PASS.
- [ ] **Step 6: Commit** — `git commit -am "refactor(1c): upsertPaymentRecord supports order∨org-level"`

### Task 7: Writers `upsertOrgRecord` + `upsertDocumentRecord`

**Files:** Modify `writers.ts`, `sync-organizations.ts`, `sync-documents.ts`; Test `oneCSync.writers.test.ts`

- [ ] **Step 1: Failing test** — org create/update через `resolveOrganizationRef`; scope `mayCreateOrgs` для новой org; document upsert паритет с текущим `sync-documents.ts`.
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — по образцу Task 5/6 вынести тела из `sync-organizations.ts` и `sync-documents.ts` в `writers.ts` (`upsertOrgRecord`, `upsertDocumentRecord`), сохранив их текущую логику дословно, добавив `ctx.scope`/`ctx.notify`/`ctx.bump`. Переписать оба процессора на вызовы writer'ов.
- [ ] **Step 4: Run** — `npm run test:unit -- worker.sync-organizations.shadow worker.sync-documents.shadow oneCSync.writers` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "refactor(1c): extract org & document writers"`

---

## Phase C — FileOneCAdapter (Excel → полный DTO)

### Task 8: Колонки статуса и ссылки на заказ

**Files:** Modify `column-map.ts`; Test `import.column-map.test.ts`

- [ ] **Step 1: Failing test** — `ORDER_COLS.financialStatusRaw === 'Статус оплаты'`, `PAYMENT_COLS.orderRef === 'Заказ'` присутствуют (опциональны при чтении).
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — добавить в `column-map.ts`:

```ts
export const ORDER_COLS = {
  externalId: 'Номер', orderNumber: 'Номер', orgInn: 'ИНН организации',
  totalAmount: 'Сумма', paidAmount: 'Оплачено', financialStatusRaw: 'Статус оплаты',
} as const;
export const PAYMENT_COLS = {
  externalId: 'Номер документа', orgInn: 'ИНН', amount: 'Сумма', paidAt: 'Дата',
  method: 'Вид операции', note: 'Назначение платежа', orderRef: 'Заказ',
} as const;
```

- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(1c): optional status & order-ref columns in Excel map"`

### Task 9: `FileOneCAdapter`

**Files:** Create `src/lib/services/oneCSync/adapter-file.ts`; Test `oneCSync.adapter-file.test.ts`

- [ ] **Step 1: Failing test** (мокаем `parseWorkbook`):

```ts
import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';

it('derives financialStatus from amounts when no status column', async () => {
  parseWorkbook.mockResolvedValue({ orgs: [], orders: [
    { externalId:'O1', orderNumber:'O1', orgInn:'77', totalAmount:100, paidAmount:100 }], payments: [] });
  const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
  expect(orders[0]).toMatchObject({ externalId:'O1', financialStatus:'paid', organizationExternalId:'77' });
});
it('uses status column via translation when present', async () => {
  parseWorkbook.mockResolvedValue({ orgs: [], orders: [
    { externalId:'O2', orderNumber:'O2', orgInn:'77', totalAmount:100, paidAmount:0, financialStatusRaw:'Счёт выставлен' }], payments: [] });
  const orders = await new FileOneCAdapter(Buffer.from('x')).pullOrders({});
  expect(orders[0].financialStatus).toBe('billed');
});
it('links payment to order when orderRef present, else org-level', async () => {
  parseWorkbook.mockResolvedValue({ orgs: [], orders: [], payments: [
    { externalId:'P1', orgInn:'77', amount:50, paidAt:'2026-04-01T00:00:00Z', method:null, note:null, orderRef:'O1' },
    { externalId:'P2', orgInn:'77', amount:50, paidAt:'2026-04-01T00:00:00Z', method:null, note:null, orderRef:null }] });
  const pays = await new FileOneCAdapter(Buffer.from('x')).pullPayments({});
  expect(pays[0]).toMatchObject({ externalId:'P1', orderExternalId:'O1' });
  expect(pays[1]).toMatchObject({ externalId:'P2', organizationExternalId:'77' });
  expect(pays[1].orderExternalId).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement** — `adapter-file.ts`. Excel-org keyed by ИНН → `externalId = inn`, `organizationExternalId = inn` (синтетический якорь; backfill реального externalId делает API-синк через resolver). `updatedAt` отсутствует в файле → `new Date(0).toISOString()` (детерминизм; курсор для файла не используется). Возврат (`isRefund`) выводится из `method` (содержит «возврат») или отрицательной суммы.

```ts
import type { OneCAdapter } from './adapter';
import type { OneCOrgDto, OneCOrderDto, OneCPaymentDto, OneCDocumentDto, OneCLeadPushPayload, OneCLeadPushResult, SyncCursor } from './dto';
import { parseWorkbook } from '@/lib/services/import/parse-workbook';
import { translateFinancialStatus } from './translate';

const EPOCH = new Date(0).toISOString();
function deriveFinStatus(total: number, paid: number, isRefund: boolean): OneCOrderDto['financialStatus'] {
  if (isRefund) return 'refunded';
  if (total <= 0) return 'not_billed';
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partially_paid';
  return 'billed';
}
type RawOrder = { externalId: string; orderNumber: string | null; orgInn: string; totalAmount: number; paidAmount: number; financialStatusRaw?: string | null };
type RawPay = { externalId: string; orgInn: string; amount: number; paidAt: string; method: string | null; note: string | null; orderRef?: string | null };
type RawOrg = { name: string; inn: string; partnerInn: string | null };

export class FileOneCAdapter implements OneCAdapter {
  constructor(private readonly buffer: Buffer | ArrayBuffer) {}
  private async sheets() { return parseWorkbook(this.buffer); }

  async pullOrganizations(_c: SyncCursor): Promise<OneCOrgDto[]> {
    const { orgs } = await this.sheets();
    return (orgs as RawOrg[]).filter(o => o?.inn).map(o => ({
      externalId: o.inn, name: o.name, inn: o.inn,
      partnerExternalId: o.partnerInn ?? undefined, updatedAt: EPOCH,
    }));
  }
  async pullOrders(_c: SyncCursor): Promise<OneCOrderDto[]> {
    const { orders } = await this.sheets();
    return (orders as RawOrder[]).filter(o => o?.externalId && o?.orgInn).map(o => {
      const total = Number(o.totalAmount) || 0, paid = Number(o.paidAmount) || 0;
      let fin = deriveFinStatus(total, paid, false);
      if (o.financialStatusRaw) { const t = translateFinancialStatus(o.financialStatusRaw); if (t.ok) fin = t.value; }
      return {
        externalId: o.externalId, orderNumber: o.orderNumber ?? undefined,
        title: o.orderNumber ?? o.externalId, organizationExternalId: o.orgInn,
        totalAmount: total, paidAmount: paid, vatIncluded: true,
        executionStatus: 'pending', financialStatus: fin, productMix: [], updatedAt: EPOCH,
      };
    });
  }
  async pullPayments(_c: SyncCursor): Promise<OneCPaymentDto[]> {
    const { payments } = await this.sheets();
    return (payments as RawPay[]).filter(p => p?.externalId && p?.orgInn).map(p => {
      const isRefund = /возврат/i.test(p.method ?? '') || Number(p.amount) < 0;
      const base = { externalId: p.externalId, amount: Number(p.amount) || 0, paidAt: p.paidAt,
        method: p.method ?? undefined, isRefund, updatedAt: EPOCH };
      return p.orderRef ? { ...base, orderExternalId: p.orderRef } : { ...base, organizationExternalId: p.orgInn };
    });
  }
  async pullDocuments(_c: SyncCursor): Promise<OneCDocumentDto[]> { return []; }   // документы файлом не грузим
  async pushLead(_p: OneCLeadPushPayload): Promise<OneCLeadPushResult> { throw new Error('FileOneCAdapter is read-only'); }
}
```

- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5:** В `oneCSync/index.ts` добавить `export { FileOneCAdapter } from './adapter-file';`
- [ ] **Step 6: Commit** — `git commit -am "feat(1c): FileOneCAdapter — Excel → full OneC DTO"`

---

## Phase D — Перевод Excel-UI на общий writer + удаление дублей

### Task 10: Переписать `import/index.ts` на общий конвейер

**Files:** Modify `src/lib/services/import/index.ts`; Test `import.contract.test.ts` (переписать)

- [ ] **Step 1: Failing test** (новый контракт — возвращает `BatchSummary` по сущностям):

```ts
import { describe, it, expect, vi } from 'vitest';
const { parseWorkbook } = vi.hoisted(() => ({ parseWorkbook: vi.fn() }));
vi.mock('@/lib/services/import/parse-workbook', () => ({ parseWorkbook }));
import { previewImport } from '@/lib/services/import';

it('rejects non-staff', async () => {
  expect(await previewImport({} as any, { role:'partner' } as any, { fileBuffer: Buffer.from('') }))
    .toEqual({ ok:false, error:'forbidden' });
});
it('previews orders with derived financialStatus without writing', async () => {
  parseWorkbook.mockResolvedValue({ orgs: [{ name:'A', inn:'77', partnerInn:null }],
    orders: [{ externalId:'O1', orderNumber:'O1', orgInn:'77', totalAmount:100, paidAmount:100 }], payments: [] });
  const db = { organization: { findFirst: vi.fn().mockResolvedValue({ id:'o', companyId:'c', partnerId:null, externalId:'77' }), update: vi.fn() },
    order: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() }, payment:{}, $transaction: undefined } as any;
  const res = await previewImport(db, { sub:'u', role:'admin' } as any, { fileBuffer: Buffer.from('x') });
  expect(res.ok).toBe(true);
  if (res.ok) { expect(res.report.orders.created).toBe(1); expect(db.order.create).not.toHaveBeenCalled(); }
});
```

- [ ] **Step 2: Run, verify fails.**

- [ ] **Step 3: Implement** — заменить содержимое `import/index.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { FileOneCAdapter } from '@/lib/services/oneCSync/adapter-file';
import { OneCOrgSchema, OneCOrderSchema, OneCPaymentSchema } from '@/lib/services/oneCSync/schemas';
import { runRecordBatch, type BatchSummary } from '@/lib/services/oneCSync/record-batch';
import { upsertOrgRecord, upsertOrderRecord, upsertPaymentRecord, type WriteCtx } from '@/lib/services/oneCSync/writers';
import { importScope } from '@/lib/services/oneCSync/scope';
import { recordAudit } from '@/lib/auth/audit';

type Args = { fileBuffer: Buffer };
type Err = 'forbidden' | 'parse_failed' | 'empty';
type Report = { orgs: BatchSummary; orders: BatchSummary; payments: BatchSummary };
function isStaff(s: SessionPayload) { return s.role === 'admin' || s.role === 'manager'; }

async function run(prisma: PrismaClient, session: SessionPayload, buffer: Buffer, mode: 'shadow' | 'live'): Promise<Report> {
  const adapter = new FileOneCAdapter(buffer);
  const ctx: WriteCtx = { mode, notify: false, scope: importScope(session) };
  const [orgsRaw, ordersRaw, paymentsRaw] = await Promise.all([
    adapter.pullOrganizations({}), adapter.pullOrders({}), adapter.pullPayments({})]);
  const orgs = await runRecordBatch(orgsRaw as unknown[], OneCOrgSchema, (d:any)=>d.externalId, (d,s)=>upsertOrgRecord(prisma,d,s,ctx));
  const orders = await runRecordBatch(ordersRaw as unknown[], OneCOrderSchema, (d:any)=>d.externalId, (d,s)=>upsertOrderRecord(prisma,d,s,ctx));
  const payments = await runRecordBatch(paymentsRaw as unknown[], OneCPaymentSchema, (d:any)=>d.externalId, (d,s)=>upsertPaymentRecord(prisma,d,s,ctx));
  return { orgs, orders, payments };
}

export async function previewImport(prisma: PrismaClient, session: SessionPayload, args: Args):
  Promise<{ ok: true; report: Report } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let report: Report;
  try { report = await run(prisma, session, args.fileBuffer, 'shadow'); }
  catch { return { ok: false, error: 'parse_failed' }; }
  const total = report.orgs.pulled + report.orders.pulled + report.payments.pulled;
  if (total === 0) return { ok: false, error: 'empty' };
  return { ok: true, report };
}

export async function commitImport(prisma: PrismaClient, session: SessionPayload, args: Args):
  Promise<{ ok: true; report: Report } | { ok: false; error: Err }> {
  if (!isStaff(session)) return { ok: false, error: 'forbidden' };
  let report: Report;
  try { report = await run(prisma, session, args.fileBuffer, 'live'); }
  catch { return { ok: false, error: 'parse_failed' }; }
  try {
    await recordAudit(prisma, { userId: session.sub, action: 'one_c_import.commit', entity: 'one_c_import',
      entityId: session.companyId ?? session.sub, after: { report } });
  } catch (e) { console.error('one_c_import audit failed (non-blocking):', e); }
  return { ok: true, report };
}
```

> Замечание по транзакции: текущий Excel-commit оборачивал всё в `$transaction`; новый конвейер пишет порекордно (как worker). Это сознательно — паритет с API-путём; частичный импорт фиксируется отчётом (карантин/skip). Если нужна атомарность всего файла — отдельное решение (вне T1).

- [ ] **Step 4: Run** — `npm run test:unit -- import.contract` → PASS.
- [ ] **Step 5: Commit** — `git commit -am "refactor(1c): Excel import routes through unified writer (preview=shadow)"`

### Task 11: Удалить расходящийся код

**Files:** Delete `commit-import.ts`, `payment-mapper.ts`, `validate.ts`, `types.ts`, `plan-import.ts`, `import/scope.ts`; Delete tests `import.payment-mapper.test.ts`, `import.validate.test.ts`, `import.plan.test.ts`.

- [ ] **Step 1:** `git rm` перечисленных файлов и их тестов.
- [ ] **Step 2:** Поправить оставшиеся импорты (`import.scope.test.ts` уже на oneCSync из Task 4). Run `npm run typecheck` → 0 ошибок.
- [ ] **Step 3: Guardrail test** — создать `import.no-second-writer.guardrail.test.ts`: ассерт, что `src/lib/services/import/` больше не содержит `prisma.order.create`/`prisma.payment.create` (grep по каталогу) — единственный путь записи через writers.
- [ ] **Step 4:** Run `npm run test:unit` → PASS (весь unit-слой).
- [ ] **Step 5: Commit** — `git commit -am "refactor(1c): delete divergent Excel pipeline (one writer)"`

### Task 12: Гард размера/MIME на загрузку (F5)

**Files:** Modify `src/server-actions/import.ts`; Test `server-actions.import.test.ts`

- [ ] **Step 1: Failing test** — файл >20 МБ или не `.xlsx` → `{ ok:false, error:'invalid_file' }`, `previewImport` не вызывается.
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — в начале `previewImportAction`/`commitImportAction` после `requireSession()`:

```ts
const MAX = 20 * 1024 * 1024;
if (file.size > MAX) return { ok: false, error: 'invalid_file' };
if (!file.name.toLowerCase().endsWith('.xlsx')) return { ok: false, error: 'invalid_file' };
```

- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(1c): size+extension guard on import upload (F5)"`

### Task 13: UI-отчёт об импорте (BatchSummary)

**Files:** Modify `src/components/import/import-form.tsx`; Test `components.import-form.test.tsx`

- [ ] **Step 1: Failing test** — компонент рендерит по `report` числа `orders.created/updated/skipped/invalid` и список причин `skips`/`invalids` (карантин виден оператору).
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — заменить чтение `plan.counts`/`quarantine` на `report.{orgs,orders,payments}.{created,updated,skipped,invalid}` + таблицу причин из `skips`/`invalids`. Сохранить превью→подтверждение поток.
- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5: Commit** — `git commit -am "feat(1c): import UI shows per-entity BatchSummary report"`

---

## Phase E — Согласованность и интеграция

### Task 14: F6 — единый фильтр KPI в leader-dashboard

**Files:** Modify `src/lib/services/leader/dashboard.ts`; Test `services.leader.dashboard.test.ts`

- [ ] **Step 1: Failing test** — `kpis.debt`, `kpis.activeOrders` и `perManager.totalAmount/paidAmount` считаются по одному правилу (либо все по `BILLED_STATUSES`, либо все без фильтра). Зафиксировать ожидание: использовать `BILLED_STATUSES` единообразно.
- [ ] **Step 2: Run, verify fails.**
- [ ] **Step 3: Implement** — привести `prisma.order.groupBy` (leader/dashboard.ts:103-123) к тому же `where: { financialStatus: { in: BILLED_STATUSES } }`, что и `getOrgFinanceKpis`.
- [ ] **Step 4: Run, verify passes.**
- [ ] **Step 5: Commit** — `git commit -am "fix(finance): consistent BILLED filter in leader dashboard KPIs (F6)"`

### Task 15: Интеграционный паритет Excel ↔ API (live-PG)

**Files:** Create `src/__tests__/import.unified.integration.test.ts` (содержит `new PrismaClient(` → integration-режим)

- [ ] **Step 1: Failing test** — один логический набор (1 орг с ИНН+партнёром, 1 заказ paid=total, 1 оплата с orderRef) подать (а) через `FileOneCAdapter`+`commitImport`; проверить в БД: заказ имеет `financialStatus='paid'`, `partnerId` от орг, `companyId`; оплата линкована к заказу (`orderId` не null). Затем тот же набор как `OneCOrderDto`/`OneCPaymentDto` через `FakeOneCAdapter`-стиль writer'ы → идентичные строки (паритет). Плюс: рядовой менеджер (scoped) не может импортом тронуть чужую орг (skip 'out_of_scope').
- [ ] **Step 2: Run** (требует живой Postgres) — `npm run test:integration -- import.unified` → сперва FAIL.
- [ ] **Step 3:** Доустранить расхождения, если выявятся (ожидается, что код Phase A–D уже корректен).
- [ ] **Step 4: Run, verify passes.** Затем полный `npm run gate` (Docker-PG) или WSL live-PG путь (см. roadmap).
- [ ] **Step 5: Commit** — `git commit -am "test(1c): Excel↔API ingestion parity + manager scope (integration)"`

---

## Финал
- [ ] `npm run typecheck && npm run lint && npm run test:unit` — всё зелёное.
- [ ] `npm run gate` (или WSL live-PG) — integration зелёный.
- [ ] Close-out `docs/superpowers/plans/2026-06-13-t1-ingestion-contract-DONE.md` (что отгружено vs план).

## Self-review заметки (для исполнителя)
- **F1** закрыт Task 5 + Task 9 (financialStatus всегда заполнен). **F3** — Task 6+9 (оплата↔заказ). **F4** — Task 9 (isRefund из method/знака). **F5** — Task 12. **F6** — Task 14. **F7** — Task 10/13 (видимый отчёт-карантин). **F2/DOC-03** намеренно НЕ здесь (T3/T2).
- **Не теряем уведомления worker'а:** `ctx.notify:true` в процессорах, `false` в Excel-импорте (ручной импорт не спамит) — подтвердить это решение с владельцем при ревью (можно включить позже).
- **Открытый вопрос плана:** уникальность `Organization.externalId` с NULL (spec §5) — проверить на Task 3; если constraint строгий, синтетический `externalId=inn` в file-адаптере уже даёт ненулевое значение (safe).
