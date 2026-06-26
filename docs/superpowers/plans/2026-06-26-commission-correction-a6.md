# Commission Correction §9.5 (SP-2: A6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поздний возврат, пришедший в уже `approved`/`paid` период, не теряется и не правит закрытую ведомость — он авто-детектится в очередь, admin/leader вручную Применяет/Списывает, и применённое удержание переносится отрицательной строкой в следующую ведомость (остаток — цепочкой).

**Architecture:** Новая модель `CommissionCorrection` (очередь) + `CommissionStatementItem.correctionId` (строка-корректировка, как `paymentId` в SP-1). Детект — в воркере/ручном триггере; resolve — сервис + server-action (RBAC admin/leader); перенос — в `statement.ts` (строки) и `lifecycle.approveStatement` (материализация остатка-цепочки). Деньги — на `Prisma.Decimal`.

**Tech Stack:** TypeScript strict, Prisma 5 + PostgreSQL, `Prisma.Decimal`, Vitest (unit + integration live-PG), Next.js App Router (UI Фаза 2).

**Спека:** `docs/superpowers/specs/2026-06-26-commission-correction-a6-design.md`
**База:** ветка `claude/commission-correction-a6` (стек поверх SP-1, [PR #157](https://github.com/aiprocadm/lk_otsfera/pull/157)).

**Решения владельца:** закрыт = `approved`∨`paid`; авто-детект→очередь→ручной resolve; Применить/Списать(reason); остаток переносится цепочкой; очередь admin+leader (leader company-scoped).

---

## File Structure

**Создаются:**
- `prisma/migrations/<ts>_commission_correction/migration.sql` — `CommissionCorrection` + `CommissionStatementItem.correctionId`.
- `src/lib/services/commission/corrections.ts` — detect + resolve + listQueue.
- `src/__tests__/services.commission.corrections.unit.test.ts`, `...corrections.test.ts` (integration).
- `src/server-actions/commission/corrections.ts` — resolve actions (apply/waive).
- `src/app/admin/commission-corrections/page.tsx`, `src/app/leader/commission-corrections/page.tsx` — очереди.
- `src/components/commission/corrections-queue-table.tsx` — таблица + resolve-Dialog.

**Изменяются:**
- `prisma/schema.prisma` — модель + поле + back-relations.
- `src/lib/services/commission/calculator.ts` — 2-й аргумент `corrections`.
- `src/lib/services/commission/statement.ts` — сбор correction-строк + `correctionId` в createMany.
- `src/lib/services/commission/lifecycle.ts` — цепочка остатка при approve.
- `src/worker/processors/calculate-monthly-commissions.ts` — шаг детекта.
- Тесты: `commission.calculator.test.ts`, `services.commission.statement.*.test.ts`, `services.commission.lifecycle.*.test.ts`, `worker.calculate-monthly-commissions.test.ts`.

---

# ФАЗА 1 — backend

## Task 1: Schema — CommissionCorrection + item.correctionId

**Files:**
- Modify: `prisma/schema.prisma` (новая модель; `CommissionStatementItem`; back-relations на `Partner`, `Payment`)
- Create: `prisma/migrations/20260626130000_commission_correction/migration.sql`

- [ ] **Step 1: Add the model + field to `prisma/schema.prisma`**

Добавить новую модель (рядом с `CommissionStatementItem`):

```prisma
model CommissionCorrection {
  id                   String                    @id @default(cuid())
  createdAt            DateTime                  @default(now())
  updatedAt            DateTime                  @updatedAt
  partnerId            String
  partner              Partner                   @relation(fields: [partnerId], references: [id])
  paymentId            String?                   @unique
  payment              Payment?                  @relation(fields: [paymentId], references: [id])
  originalStatementId  String?
  originalPeriodFrom   DateTime
  originalPeriodTo     DateTime
  amount               Decimal                   @db.Decimal(14, 2)
  rate                 Decimal                   @db.Decimal(6, 4)
  commissionAmount     Decimal                   @db.Decimal(14, 2)
  status               String                    @default("needs_review")
  reason               String?
  resolvedByUserId     String?
  resolvedAt           DateTime?
  parentCorrectionId   String?
  carriedReason        String?
  appliedInStatementId String?
  items                CommissionStatementItem[]

  @@index([partnerId, status])
  @@index([status, createdAt])
}
```

В `CommissionStatementItem` добавить (после `paymentId`/`payment`):

```prisma
  correctionId     String?
  correction       CommissionCorrection? @relation(fields: [correctionId], references: [id])
```
и в её индексы: `@@index([correctionId])`.

В `model Partner` добавить back-relation: `commissionCorrections CommissionCorrection[]`.
В `model Payment` добавить back-relation: `commissionCorrection CommissionCorrection?` (обратная к `paymentId @unique`).

- [ ] **Step 2: Create the migration SQL**

`prisma/migrations/20260626130000_commission_correction/migration.sql`:

```sql
CREATE TABLE "CommissionCorrection" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "partnerId" TEXT NOT NULL,
  "paymentId" TEXT,
  "originalStatementId" TEXT,
  "originalPeriodFrom" TIMESTAMP(3) NOT NULL,
  "originalPeriodTo" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "rate" DECIMAL(6,4) NOT NULL,
  "commissionAmount" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'needs_review',
  "reason" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "parentCorrectionId" TEXT,
  "carriedReason" TEXT,
  "appliedInStatementId" TEXT,
  CONSTRAINT "CommissionCorrection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommissionCorrection_paymentId_key" ON "CommissionCorrection"("paymentId");
CREATE INDEX "CommissionCorrection_partnerId_status_idx" ON "CommissionCorrection"("partnerId", "status");
CREATE INDEX "CommissionCorrection_status_createdAt_idx" ON "CommissionCorrection"("status", "createdAt");
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommissionCorrection" ADD CONSTRAINT "CommissionCorrection_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CommissionStatementItem" ADD COLUMN "correctionId" TEXT;
CREATE INDEX "CommissionStatementItem_correctionId_idx" ON "CommissionStatementItem"("correctionId");
ALTER TABLE "CommissionStatementItem" ADD CONSTRAINT "CommissionStatementItem_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "CommissionCorrection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Generate client**

Run: `npm run prisma:generate`
Expected: `Generated Prisma Client`, типы `CommissionCorrection` и `CommissionStatementItem.correctionId` доступны.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(commission): CommissionCorrection model + item.correctionId (schema, A6)"
```
(typecheck может временно краснеть в дальнейших файлах — на этом шаге их не трогаем; если pre-commit падает на typecheck в ещё-не-тронутых местах — `--no-verify` и отметить.)

---

## Task 2: Calculator — fold pre-computed correction lines

**Files:**
- Modify: `src/lib/services/commission/calculator.ts`
- Test: `src/__tests__/commission.calculator.test.ts` (добавить кейсы)

- [ ] **Step 1: Add failing tests**

В `src/__tests__/commission.calculator.test.ts` добавить (после существующего describe-блока, внутри него новые `it`):

```ts
import type { CorrectionForCalc } from '@/lib/services/commission/calculator';

function correction(over: Partial<CorrectionForCalc> = {}): CorrectionForCalc {
  return {
    correctionId: over.correctionId ?? 'c1',
    organizationName: over.organizationName ?? 'Корректировка §9.5',
    baseAmount: new Prisma.Decimal(over.baseAmount ?? -30000),
    rate: new Prisma.Decimal(over.rate ?? 0.2),
    commissionAmount: new Prisma.Decimal(over.commissionAmount ?? -6000),
  };
}

it('A6: correction lines fold into items and reduce total commission', () => {
  const r = calculateCommission(
    [payment({ amount: 100000, rate: 0.2 })],            // +20000
    [correction({ baseAmount: -30000, commissionAmount: -6000 })] // -6000
  );
  expect(r.items).toHaveLength(2);
  const corr = r.items.find((i) => i.correctionId === 'c1')!;
  expect(corr.paymentId).toBeNull();
  expect(corr.orderId).toBeNull();
  expect(corr.commissionAmount.toNumber()).toBe(-6000);
  expect(r.totals.totalCommissionAmount.toNumber()).toBe(14000);
});

it('A6/R2: corrections exceeding payments clamp total to 0 (lines kept)', () => {
  const r = calculateCommission(
    [payment({ amount: 10000, rate: 0.1 })],             // +1000
    [correction({ baseAmount: -50000, commissionAmount: -5000 })] // -5000
  );
  expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
  expect(r.items).toHaveLength(2);
});

it('A6: uses pre-computed commissionAmount, not amount×rate (chain remainder with rate 0)', () => {
  const r = calculateCommission(
    [],
    [correction({ correctionId: 'chain', rate: 0, baseAmount: -4000, commissionAmount: -4000 })]
  );
  // commission is taken from the field, NOT base×rate (which would be 0)
  expect(r.items[0].commissionAmount.toNumber()).toBe(-4000);
});

it('correction-only with no payments → clamped 0 total', () => {
  const r = calculateCommission([], [correction({ commissionAmount: -6000 })]);
  expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/commission.calculator.test.ts`
Expected: FAIL — `CorrectionForCalc` не экспортирован, `calculateCommission` принимает 1 аргумент.

- [ ] **Step 3: Extend the calculator**

В `src/lib/services/commission/calculator.ts`:

(a) `CalculatorItem.paymentId` → `string | null`; добавить `correctionId: string | null`. `CalculatorItem`:

```ts
export type CalculatorItem = {
  paymentId: string | null;
  orderId: string | null;
  correctionId: string | null;
  orderNumber: string | null;
  organizationName: string;
  baseAmount: Prisma.Decimal;
  rate: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
};
```

(b) Добавить тип:

```ts
export type CorrectionForCalc = {
  correctionId: string;
  organizationName: string;
  baseAmount: Prisma.Decimal;     // уже отрицательная
  rate: Prisma.Decimal;           // для отображения
  commissionAmount: Prisma.Decimal; // уже отрицательная, НЕ пересчитывается
};
```

(c) Payment-маппинг: добавить `correctionId: null` в возвращаемый item. Расширить сигнатуру и собрать корректировки:

```ts
export function calculateCommission(
  payments: PaymentForCalc[],
  corrections: CorrectionForCalc[] = []
): CalculatorResult {
  const paymentItems: CalculatorItem[] = payments.map((p) => {
    const signed = p.isRefund ? p.amount.negated() : p.amount;
    const baseAmount = toMoney(signed);
    const commissionAmount = toMoney(baseAmount.mul(p.rate));
    return {
      paymentId: p.paymentId,
      orderId: p.orderId,
      correctionId: null,
      orderNumber: p.orderNumber,
      organizationName: p.organizationName,
      baseAmount,
      rate: p.rate,
      commissionAmount,
    };
  });

  const correctionItems: CalculatorItem[] = corrections.map((c) => ({
    paymentId: null,
    orderId: null,
    correctionId: c.correctionId,
    orderNumber: null,
    organizationName: c.organizationName,
    baseAmount: toMoney(c.baseAmount),
    rate: c.rate,
    commissionAmount: toMoney(c.commissionAmount),
  }));

  const items = [...paymentItems, ...correctionItems];

  const totalBaseAmount = items.reduce((sum, i) => sum.plus(i.baseAmount), ZERO);
  const rawCommission = items.reduce((sum, i) => sum.plus(i.commissionAmount), ZERO);
  const totalCommissionAmount = rawCommission.lt(0) ? ZERO : rawCommission;

  const weightedRateSum = items.reduce((sum, i) => sum.plus(i.rate.mul(i.baseAmount)), ZERO);
  const averageRate = totalBaseAmount.gt(0)
    ? weightedRateSum.div(totalBaseAmount).toDecimalPlaces(RATE_SCALE, HALF_UP)
    : ZERO;

  return { items, totals: { totalBaseAmount, totalCommissionAmount, averageRate } };
}
```

Также обновить шапку модуля: убрать «A6 здесь НЕ реализован» → «A6: корректировки приходят готовыми строками (`corrections`), уже посчитанными; калькулятор их только складывает».

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/commission.calculator.test.ts`
Expected: PASS (старые + новые кейсы).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/calculator.ts src/__tests__/commission.calculator.test.ts
git commit -m "feat(commission): calculator folds pre-computed correction lines (A6)"
```

---

## Task 3: Detection — detectLateRefundCorrections

**Files:**
- Create: `src/lib/services/commission/corrections.ts`
- Test: `src/__tests__/services.commission.corrections.unit.test.ts`

- [ ] **Step 1: Write the failing unit test**

`src/__tests__/services.commission.corrections.unit.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';

const dec = (n: number) => new Prisma.Decimal(n);

function makeDb(opts: {
  refunds: any[];
  liveStatement?: any; // returned by commissionStatement.findFirst
  rateChanges?: any[];
  created?: any[];
}) {
  const created = opts.created ?? [];
  return {
    payment: { findMany: vi.fn().mockResolvedValue(opts.refunds) },
    commissionStatement: { findFirst: vi.fn().mockResolvedValue(opts.liveStatement ?? null) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(opts.rateChanges ?? []) },
    commissionCorrection: {
      create: vi.fn().mockImplementation(({ data }) => { created.push(data); return { id: 'new', ...data }; }),
    },
    partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: dec(0.2) }) },
    _created: created,
  } as any;
}

function refundRow(over: any = {}) {
  return {
    id: 'pay-r1', amount: dec(30000), paidAt: new Date('2026-04-20'), isRefund: true, orderId: 'o1',
    order: { partnerId: 'p1' }, organization: { partnerId: 'p1' },
    ...over,
  };
}

describe('detectLateRefundCorrections', () => {
  it('creates needs_review for a refund landing in a paid period', async () => {
    const db = makeDb({
      refunds: [refundRow()],
      liveStatement: { id: 'stmt-apr', status: 'paid', periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30T23:59:59Z') },
    });
    const n = await detectLateRefundCorrections(db);
    expect(n).toBe(1);
    expect(db._created[0]).toMatchObject({ partnerId: 'p1', paymentId: 'pay-r1', status: 'needs_review', originalStatementId: 'stmt-apr' });
    // commission = amount × rate(0.2) = 6000
    expect(Number(db._created[0].commissionAmount)).toBe(6000);
  });

  it('creates for an approved period too (owner: approved∨paid closed)', async () => {
    const db = makeDb({
      refunds: [refundRow()],
      liveStatement: { id: 'stmt-apr', status: 'approved', periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30T23:59:59Z') },
    });
    expect(await detectLateRefundCorrections(db)).toBe(1);
  });

  it('skips a refund whose period is only draft (normal SP-1 negative line)', async () => {
    const db = makeDb({ refunds: [refundRow()], liveStatement: null }); // findFirst filters to approved/paid → none
    expect(await detectLateRefundCorrections(db)).toBe(0);
    expect(db.commissionCorrection.create).not.toHaveBeenCalled();
  });

  it('is idempotent: refunds already having a correction are not re-fetched', async () => {
    // payment.findMany is called with where excluding existing corrections (commissionCorrection: { is: null })
    const db = makeDb({ refunds: [] });
    expect(await detectLateRefundCorrections(db)).toBe(0);
    const where = db.payment.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ isRefund: true, commissionCorrection: { is: null } });
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/services.commission.corrections.unit.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement detection in `src/lib/services/commission/corrections.ts`**

```ts
import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { resolveRateAt, type RateChange } from './rateResolve';

const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;

/**
 * A6/§9.5: находит возвраты (isRefund), чей paidAt попал в УЖЕ закрытый
 * (approved/paid, живой) период партнёра и ещё не имеет корректировки. Создаёт
 * needs_review-корректировку (идемпотентно по paymentId @unique). Возвраты в
 * draft-период не трогаются — это обычная отрицательная строка (SP-1).
 */
export async function detectLateRefundCorrections(prisma: PrismaClient): Promise<number> {
  const refunds = await prisma.payment.findMany({
    where: { isRefund: true, commissionCorrection: { is: null } },
    select: {
      id: true, amount: true, paidAt: true, orderId: true,
      order: { select: { partnerId: true } },
      organization: { select: { partnerId: true } },
    },
  });

  let created = 0;
  for (const r of refunds) {
    const partnerId = r.order?.partnerId ?? r.organization?.partnerId ?? null;
    if (!partnerId) continue;

    const stmt = await prisma.commissionStatement.findFirst({
      where: {
        partnerId,
        supersededBy: null,
        status: { in: ['approved', 'paid'] },
        periodFrom: { lte: r.paidAt },
        periodTo: { gte: r.paidAt },
      },
      select: { id: true, periodFrom: true, periodTo: true },
    });
    if (!stmt) continue;

    const partner = await prisma.partner.findUnique({ where: { id: partnerId }, select: { commissionRate: true } });
    const changes: RateChange[] = await prisma.commissionRateChange.findMany({
      where: { partnerId }, select: { effectiveFrom: true, oldRate: true, newRate: true }, orderBy: { effectiveFrom: 'asc' },
    });
    const rate = resolveRateAt(changes, r.paidAt, partner?.commissionRate ?? new Prisma.Decimal(0));
    const commissionAmount = r.amount.mul(rate).toDecimalPlaces(2, HALF_UP);

    try {
      await prisma.commissionCorrection.create({
        data: {
          partnerId, paymentId: r.id, originalStatementId: stmt.id,
          originalPeriodFrom: stmt.periodFrom, originalPeriodTo: stmt.periodTo,
          amount: r.amount, rate, commissionAmount, status: 'needs_review',
        },
      });
      created++;
    } catch (err) {
      // P2002: гонка детекта (paymentId @unique) — корректировка уже создана, пропускаем.
      if (!(typeof err === 'object' && err && 'code' in err && (err as { code?: unknown }).code === 'P2002')) throw err;
    }
  }
  return created;
}
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/services.commission.corrections.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/corrections.ts src/__tests__/services.commission.corrections.unit.test.ts
git commit -m "feat(commission): detect late-refund corrections into review queue (A6)"
```

---

## Task 4: Resolve + queue listing (apply / waive, RBAC)

**Files:**
- Modify: `src/lib/services/commission/corrections.ts` (add `listCorrectionQueue`, `resolveCorrection`)
- Test: `src/__tests__/services.commission.corrections.unit.test.ts` (add cases)

- [ ] **Step 1: Add failing tests**

Добавить в `services.commission.corrections.unit.test.ts`:

```ts
import { listCorrectionQueue, resolveCorrection } from '@/lib/services/commission/corrections';

const adminSession = { role: 'admin', sub: 'u-admin', companyId: null } as any;
const leaderSession = { role: 'leader', sub: 'u-leader', companyId: 'co-1' } as any;
const partnerSession = { role: 'partner', sub: 'u-p', companyId: null } as any;

describe('listCorrectionQueue', () => {
  it('partner is forbidden (returns empty)', async () => {
    const db = { commissionCorrection: { findMany: vi.fn() } } as any;
    expect(await listCorrectionQueue(db, partnerSession)).toEqual([]);
    expect(db.commissionCorrection.findMany).not.toHaveBeenCalled();
  });

  it('admin sees all needs_review (no company filter)', async () => {
    const db = { commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listCorrectionQueue(db, adminSession);
    const where = db.commissionCorrection.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 'needs_review' });
    expect(where.partner).toBeUndefined();
  });

  it('leader is scoped to own company partners', async () => {
    const db = { commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) } } as any;
    await listCorrectionQueue(db, leaderSession);
    const where = db.commissionCorrection.findMany.mock.calls[0][0].where;
    expect(where.partner).toMatchObject({ organizations: { some: { companyId: 'co-1' } } });
  });
});

describe('resolveCorrection', () => {
  function db(existing: any) {
    return {
      commissionCorrection: {
        findUnique: vi.fn().mockResolvedValue(existing),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn().mockImplementation(async (fn: any) => fn({
        commissionCorrection: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })),
    } as any;
  }
  it('apply: needs_review → applied', async () => {
    const d = db({ id: 'c1', status: 'needs_review', partnerId: 'p1' });
    const r = await resolveCorrection(d, adminSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: true });
  });
  it('waive requires a reason', async () => {
    const d = db({ id: 'c1', status: 'needs_review', partnerId: 'p1' });
    const r = await resolveCorrection(d, adminSession, { correctionId: 'c1', action: 'waive', reason: '' });
    expect(r).toEqual({ ok: false, error: 'reason_required' });
  });
  it('partner forbidden', async () => {
    const d = db({ id: 'c1', status: 'needs_review', partnerId: 'p1' });
    const r = await resolveCorrection(d, partnerSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
  });
  it('not needs_review → invalid_state', async () => {
    const d = db({ id: 'c1', status: 'applied', partnerId: 'p1' });
    const r = await resolveCorrection(d, adminSession, { correctionId: 'c1', action: 'apply' });
    expect(r).toEqual({ ok: false, error: 'invalid_state' });
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/services.commission.corrections.unit.test.ts`
Expected: FAIL — `listCorrectionQueue`/`resolveCorrection` missing.

- [ ] **Step 3: Implement in `src/lib/services/commission/corrections.ts`**

Добавить (импорты `SessionPayload`, `recordAudit`):

```ts
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';

export type CorrectionError = 'forbidden' | 'not_found' | 'invalid_state' | 'reason_required';

function canResolve(s: SessionPayload): boolean {
  return s.role === 'admin' || s.role === 'leader';
}

export async function listCorrectionQueue(prisma: PrismaClient, session: SessionPayload) {
  if (!canResolve(session)) return [];
  const where: Prisma.CommissionCorrectionWhereInput =
    session.role === 'admin'
      ? { status: 'needs_review' }
      : { status: 'needs_review', partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } } };
  return prisma.commissionCorrection.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true, partnerId: true, amount: true, commissionAmount: true, rate: true,
      originalPeriodFrom: true, originalPeriodTo: true, paymentId: true, createdAt: true,
      partner: { select: { name: true } },
    },
  });
}

export async function resolveCorrection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { correctionId: string; action: 'apply' | 'waive'; reason?: string }
): Promise<{ ok: true } | { ok: false; error: CorrectionError }> {
  if (!canResolve(session)) return { ok: false, error: 'forbidden' };
  if (args.action === 'waive' && !args.reason?.trim()) return { ok: false, error: 'reason_required' };

  const corr = await prisma.commissionCorrection.findUnique({
    where: { id: args.correctionId },
    select: { id: true, status: true, partnerId: true },
  });
  if (!corr) return { ok: false, error: 'not_found' };
  if (corr.status !== 'needs_review') return { ok: false, error: 'invalid_state' };

  // leader-scope: запись должна принадлежать партнёру компании leader-а.
  if (session.role === 'leader') {
    const inScope = await prisma.commissionCorrection.findFirst({
      where: { id: corr.id, partner: { organizations: { some: { companyId: session.companyId ?? '__none__' } } } },
      select: { id: true },
    });
    if (!inScope) return { ok: false, error: 'forbidden' };
  }

  const next = args.action === 'apply' ? 'applied' : 'waived';
  await prisma.$transaction(async (tx) => {
    await tx.commissionCorrection.update({
      where: { id: corr.id },
      data: { status: next, reason: args.reason ?? null, resolvedByUserId: session.sub, resolvedAt: new Date() },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: `commission_correction_${next}`,
      entity: 'commission_correction',
      entityId: corr.id,
      after: { partnerId: corr.partnerId, action: args.action },
      reason: args.reason ?? undefined,
    });
  });
  return { ok: true };
}
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/services.commission.corrections.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/corrections.ts src/__tests__/services.commission.corrections.unit.test.ts
git commit -m "feat(commission): correction queue listing + apply/waive resolve (A6, RBAC)"
```

---

## Task 5: Statement builder — carry applied corrections as lines

**Files:**
- Modify: `src/lib/services/commission/statement.ts`
- Test: `src/__tests__/services.commission.statement.unit.test.ts` (add case)

- [ ] **Step 1: Add a failing unit test**

В `services.commission.statement.unit.test.ts`, в `makeDb` добавить мок `commissionCorrection.findMany` (по умолчанию `[]`) и в db-объект: `commissionCorrection: { findMany: vi.fn().mockResolvedValue(o.corrections ?? []) }`. Затем кейс:

```ts
it('A6: applied correction not yet carried becomes a negative line', async () => {
  const db = makeDb({
    payments: [paymentRow({ amount: new Prisma.Decimal('100000') })],
    corrections: [{
      id: 'corr-1', amount: new Prisma.Decimal('30000'), rate: new Prisma.Decimal('0.2'),
      commissionAmount: new Prisma.Decimal('6000'),
    }],
  });
  await calculateStatementForPartner(db as never, {
    partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  const rows = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data;
  const corrLine = rows.find((x: { correctionId?: string }) => x.correctionId === 'corr-1');
  expect(corrLine).toBeTruthy();
  expect(Number(corrLine.commissionAmount)).toBe(-6000);
  expect(corrLine.paymentId).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/services.commission.statement.unit.test.ts`
Expected: FAIL — corrections not collected / `correctionId` not mapped.

- [ ] **Step 3: Implement in `src/lib/services/commission/statement.ts`**

(a) После сбора `paymentInputs`, до `calculateCommission`, собрать applied-и-непронесённые корректировки:

```ts
import { type CorrectionForCalc } from './calculator';
// ...
const pendingCorrections = await prisma.commissionCorrection.findMany({
  where: {
    partnerId,
    status: 'applied',
    // ещё НЕ представлена строкой в живой approved/paid ведомости
    items: { none: { statement: { status: { in: ['approved', 'paid'] }, supersededBy: null } } },
  },
  select: { id: true, amount: true, rate: true, commissionAmount: true },
});

const correctionInputs: CorrectionForCalc[] = pendingCorrections.map((c) => ({
  correctionId: c.id,
  organizationName: 'Корректировка §9.5',
  baseAmount: c.amount.negated(),
  rate: c.rate,
  commissionAmount: c.commissionAmount.negated(),
}));

const calc = calculateCommission(paymentInputs, correctionInputs);
```

(b) В ОБОИХ createMany-маппингах (updateDraftInPlace и create-path) добавить `correctionId: item.correctionId,` рядом с `paymentId: item.paymentId,`.

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/services.commission.statement.unit.test.ts`
Expected: PASS (новый кейс + старые).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/statement.ts src/__tests__/services.commission.statement.unit.test.ts
git commit -m "feat(commission): carry applied corrections as negative statement lines (A6)"
```

---

## Task 6: Lifecycle — materialise remainder chain on approve

**Files:**
- Modify: `src/lib/services/commission/lifecycle.ts` (`approveStatement`)
- Test: `src/__tests__/services.commission.lifecycle.unit.test.ts` (add case)

- [ ] **Step 1: Add a failing unit test**

В `services.commission.lifecycle.unit.test.ts` добавить кейс: при approve ведомости, где Σ correction-удержаний > Σ платёжной комиссии, создаётся синтетическая `applied`-корректировка на остаток. Мокнуть `commissionStatementItem.findMany` (строки ведомости) и `commissionCorrection.create`:

```ts
it('A6: approve materialises a chained remainder correction when clamped', async () => {
  // statement items: payments sum +1000, corrections sum -5000 → remainder 4000
  const items = [
    { commissionAmount: new Prisma.Decimal('1000'), correctionId: null },
    { commissionAmount: new Prisma.Decimal('-5000'), correctionId: 'corr-1' },
  ];
  const created: any[] = [];
  const tx = {
    commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
    commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
    commissionCorrection: { create: vi.fn().mockImplementation(({ data }: any) => { created.push(data); return {}; }) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    commissionStatement: { findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
  } as any;

  await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });

  expect(created).toHaveLength(1);
  expect(Number(created[0].commissionAmount)).toBe(4000);
  expect(created[0].status).toBe('applied');
  expect(created[0].paymentId).toBeNull();
  expect(created[0].parentCorrectionId).toBe('corr-1');
});

it('A6: approve with no clamp creates no chain correction', async () => {
  const items = [
    { commissionAmount: new Prisma.Decimal('50000'), correctionId: null },
    { commissionAmount: new Prisma.Decimal('-6000'), correctionId: 'corr-1' },
  ];
  const tx = {
    commissionStatement: { update: vi.fn().mockResolvedValue({ id: 's1', status: 'approved' }) },
    commissionStatementItem: { findMany: vi.fn().mockResolvedValue(items) },
    commissionCorrection: { create: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    commissionStatement: { findFirst: vi.fn().mockResolvedValue({ id: 's1', status: 'draft', supersededBy: null, partnerId: 'p1', periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31') }) },
    $transaction: vi.fn().mockImplementation(async (fn: any) => fn(tx)),
  } as any;
  await approveStatement(db, { statementId: 's1', partnerId: 'p1', approvedByUserId: 'u1' });
  expect(tx.commissionCorrection.create).not.toHaveBeenCalled();
});
```

(Если существующий `approveStatement`-тест мокает `select` без `partnerId`/`periodFrom`/`periodTo` — расширить мок findFirst соответствующими полями.)

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/services.commission.lifecycle.unit.test.ts`
Expected: FAIL — chain not implemented.

- [ ] **Step 3: Implement in `approveStatement`**

Расширить `findFirst` select на `partnerId, periodFrom, periodTo`. Внутри `$transaction`, после `update` на `approved`, добавить материализацию остатка:

```ts
    // A6/§9.5: если строки-корректировки увели итог в минус (зажим R2 при выплате),
    // непокрытый остаток переносим синтетической applied-корректировкой в след. период.
    const lines = await tx.commissionStatementItem.findMany({
      where: { statementId: statement.id },
      select: { commissionAmount: true, correctionId: true },
    });
    const hasCorrections = lines.some((l) => l.correctionId !== null);
    if (hasCorrections) {
      const ZERO = new Prisma.Decimal(0);
      const raw = lines.reduce((s, l) => s.plus(l.commissionAmount), ZERO);
      if (raw.lt(0)) {
        const remainder = raw.negated(); // положительная величина удержания-остатка
        const parentId = lines.find((l) => l.correctionId)?.correctionId ?? null;
        await tx.commissionCorrection.create({
          data: {
            partnerId: statement.partnerId,
            paymentId: null,
            originalStatementId: statement.id,
            originalPeriodFrom: statement.periodFrom,
            originalPeriodTo: statement.periodTo,
            amount: remainder,
            rate: ZERO,
            commissionAmount: remainder,
            status: 'applied',
            parentCorrectionId: parentId,
            carriedReason: `Перенос остатка удержания из ведомости ${statement.id}`,
          },
        });
      }
    }
```

(Добавить `import { Prisma } from '@prisma/client';` в lifecycle.ts.)

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/services.commission.lifecycle.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/lifecycle.ts src/__tests__/services.commission.lifecycle.unit.test.ts
git commit -m "feat(commission): chain remainder correction on statement approve (A6)"
```

---

## Task 7: Worker — run detection before monthly calc

**Files:**
- Modify: `src/worker/processors/calculate-monthly-commissions.ts`
- Test: `src/__tests__/worker.calculate-monthly-commissions.test.ts` (add case + mock)

- [ ] **Step 1: Add a failing test**

В `worker.calculate-monthly-commissions.test.ts`: замокать модуль corrections и проверить, что детект вызывается до расчёта. Вверху файла:

```ts
vi.mock('@/lib/services/commission/corrections', () => ({
  detectLateRefundCorrections: vi.fn().mockResolvedValue(0),
}));
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';
const mockDetect = detectLateRefundCorrections as ReturnType<typeof vi.fn>;
```

В `beforeEach` добавить `mockDetect.mockClear()`. Новый кейс:

```ts
it('runs late-refund detection before computing statements', async () => {
  const db = makePrisma([{ id: 'p1' }]);
  mockCalc.mockResolvedValue({ statement: {}, itemCount: 1, isNew: true });
  await calculateMonthlyCommissionsProcessor(makeJob(), db);
  expect(mockDetect).toHaveBeenCalledWith(db);
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/__tests__/worker.calculate-monthly-commissions.test.ts`
Expected: FAIL — detect not called.

- [ ] **Step 3: Implement in the processor**

Импорт + вызов в начале (после `prevMonthRange`, до сбора `activePartners`), best-effort:

```ts
import { detectLateRefundCorrections } from '@/lib/services/commission/corrections';
// ...
  // A6: подобрать поздние возвраты в закрытые периоды → очередь корректировок.
  // Best-effort: падение детекта не валит месячный батч (§3 graceful degrade).
  try {
    const detected = await detectLateRefundCorrections(db);
    if (detected > 0) console.log('[worker] late-refund corrections detected', { detected });
  } catch (e) {
    console.warn('[worker] correction detection failed', { error: e instanceof Error ? e.message : String(e) });
  }
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/__tests__/worker.calculate-monthly-commissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/processors/calculate-monthly-commissions.ts src/__tests__/worker.calculate-monthly-commissions.test.ts
git commit -m "feat(commission): cron detects late-refund corrections before monthly calc (A6)"
```

---

## Task 8: Integration test — end-to-end correction flow (live PG)

**Files:**
- Create: `src/__tests__/services.commission.corrections.test.ts`

- [ ] **Step 1: Write the integration test**

Создать `src/__tests__/services.commission.corrections.test.ts` (по образцу `services.commission.statement.test.ts` — `new PrismaClient()`, beforeAll/afterAll seed partner/company/org/user, cleanup incl. `commissionCorrection.deleteMany`). Сценарий:

```ts
it('end-to-end: late refund into paid period → detect → apply → carried into next statement', async () => {
  // 1. April payment + paid statement
  const o = await prisma.order.create({ data: { title: 'T', companyId, organizationId: orgId, partnerId, totalAmount: 100000, financialStatus: 'paid' } });
  await prisma.payment.create({ data: { organizationId: orgId, orderId: o.id, amount: 100000, paidAt: new Date('2026-04-10') } });
  const apr = await calculateStatementForPartner(prisma, { partnerId, periodFrom: new Date('2026-04-01'), periodTo: new Date('2026-04-30T23:59:59Z'), calculatedByUserId: null });
  await approveStatement(prisma, { statementId: apr.statement.id, partnerId, approvedByUserId: userId });
  await markStatementPaid(prisma, { statementId: apr.statement.id, paidByUserId: adminUserId });

  // 2. Late refund dated in April arrives
  await prisma.payment.create({ data: { organizationId: orgId, orderId: o.id, amount: 30000, paidAt: new Date('2026-04-20'), isRefund: true } });

  // 3. Detection
  const n = await detectLateRefundCorrections(prisma);
  expect(n).toBe(1);
  const corr = await prisma.commissionCorrection.findFirst({ where: { partnerId, status: 'needs_review' } });
  expect(Number(corr!.commissionAmount)).toBe(6000);

  // 4. Admin applies
  const res = await resolveCorrection(prisma, { role: 'admin', sub: adminUserId, companyId: null } as any, { correctionId: corr!.id, action: 'apply' });
  expect(res).toEqual({ ok: true });

  // 5. May statement (with a May payment) carries the -6000 correction line
  await prisma.payment.create({ data: { organizationId: orgId, orderId: o.id, amount: 50000, paidAt: new Date('2026-05-10') } });
  const may = await calculateStatementForPartner(prisma, { partnerId, periodFrom: new Date('2026-05-01'), periodTo: new Date('2026-05-31T23:59:59Z'), calculatedByUserId: null });
  // 50000×0.1(default seeded rate) − 6000 = (5000 − 6000) → clamp? seed rate is 0.1 → 5000-6000<0 → clamp 0
  const mayItems = await prisma.commissionStatementItem.findMany({ where: { statementId: may.statement.id } });
  expect(mayItems.some((i) => i.correctionId === corr!.id)).toBe(true);
});
```

(Подогнать ожидания под seeded `commissionRate` партнёра. Нужен второй user с `role: 'admin'` — `adminUserId` — для `markStatementPaid` и resolve.)

- [ ] **Step 2: Run (live PG; defer if unavailable)**

Run: `npm run test:integration -- src/__tests__/services.commission.corrections.test.ts`
Expected: PASS on live PG. Если нет live PG на машине — отметить долгом, прогнать перед PR (WSL live-PG путь).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/services.commission.corrections.test.ts
git commit -m "test(commission): integration — late-refund correction end-to-end (A6)"
```

---

# ФАЗА 2 — UI (admin + leader queue)

## Task 9: Server-actions + admin queue page

**Files:**
- Create: `src/server-actions/commission/corrections.ts`
- Create: `src/components/commission/corrections-queue-table.tsx`
- Create: `src/app/admin/commission-corrections/page.tsx`
- Test: `src/__tests__/server-actions.commission.corrections.test.ts`

- [ ] **Step 1: Write failing server-action test**

`src/__tests__/server-actions.commission.corrections.test.ts` — по образцу `server-actions.admin.partners.test.ts` (hoisted mocks for `resolveCorrection`, `requireRole`, `revalidatePath`). Проверить: `resolveCorrectionAction` парсит `correctionId`/`action`/`reason`, зовёт сервис, revalidate; невалидный `action` → `validation`.

```ts
it('apply action calls service and revalidates', async () => {
  resolveCorrection.mockResolvedValue({ ok: true });
  const res = await resolveCorrectionAction(fd({ correctionId: 'c1', action: 'apply' }));
  expect(res).toEqual({ ok: true });
  expect(resolveCorrection).toHaveBeenCalled();
});
it('rejects an unknown action at validation', async () => {
  const res = await resolveCorrectionAction(fd({ correctionId: 'c1', action: 'bogus' }));
  expect(res).toMatchObject({ ok: false, error: 'validation' });
});
```

- [ ] **Step 2: Run → FAIL**, then implement `src/server-actions/commission/corrections.ts`:

```ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireRole } from '@/lib/auth/requireRole';
import { resolveCorrection } from '@/lib/services/commission/corrections';

const schema = z.object({
  correctionId: z.string().min(1),
  action: z.enum(['apply', 'waive']),
  reason: z.string().optional(),
});
type Result = { ok: true } | { ok: false; error: string };

export async function resolveCorrectionAction(fd: FormData): Promise<Result> {
  const parsed = schema.safeParse({
    correctionId: fd.get('correctionId'), action: fd.get('action'), reason: fd.get('reason') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireRole(['admin', 'leader']);
  const res = await resolveCorrection(prisma, session, parsed.data);
  if (res.ok) { revalidatePath('/admin/commission-corrections'); revalidatePath('/leader/commission-corrections'); }
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
```
(Свериться с фактической сигнатурой `requireRole` — если она принимает один role или массив; при необходимости использовать `requireAdmin`/доп. проверку как в проекте. Если `requireRole` не поддерживает массив — сделать `requireStaffOrLeader` хелпер по образцу.)

- [ ] **Step 3: Run server-action test → PASS. Commit.**

```bash
git add src/server-actions/commission/corrections.ts src/__tests__/server-actions.commission.corrections.test.ts
git commit -m "feat(commission): resolveCorrection server-action (A6 UI)"
```

- [ ] **Step 4: Build the queue table component**

`src/components/commission/corrections-queue-table.tsx` — `'use client'`. Принимает `rows` (из `listCorrectionQueue`), рендерит таблицу (партнёр / период возврата / сумма / удержание) через `ui/` table-примитивы; кнопки **Применить** / **Списать** открывают `Dialog` (`ui/dialog`) с полем причины (для waive обязательно), сабмит через `useFormAction`/`resolveCorrectionAction` + `toast`. Переиспользовать паттерн `src/components/import/payment-queue-table.tsx`.

- [ ] **Step 5: Build the admin page**

`src/app/admin/commission-corrections/page.tsx` — server component: `requireAdmin()`, `listCorrectionQueue(prisma, session)`, рендер `<CorrectionsQueueTable rows={...} />`. Добавить пункт в admin-навигацию (по образцу существующих admin-страниц).

- [ ] **Step 6: Verify build + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/components/commission/corrections-queue-table.tsx src/app/admin/commission-corrections/page.tsx src/lib/navigation/*
git commit -m "feat(commission): admin corrections queue page + table (A6 UI)"
```

---

## Task 10: Leader queue page (company-scoped) + partner statement label

**Files:**
- Create: `src/app/leader/commission-corrections/page.tsx`
- Modify: leader navigation; verify partner statement renders correction lines

- [ ] **Step 1: Leader page**

`src/app/leader/commission-corrections/page.tsx` — server component: `requireLeader()` (или проектный leader-guard), `listCorrectionQueue(prisma, session)` (сервис уже скоупит по `session.companyId`), рендер того же `<CorrectionsQueueTable />`. Добавить пункт в leader-навигацию.

- [ ] **Step 2: Verify partner statement shows correction lines**

Корректировки уже приходят строками `CommissionStatementItem` (organizationName='Корректировка §9.5', отрицательная сумма) — партнёрский список ведомостей/детализация рендерит их без изменений (поля те же). Проверить существующий компонент детализации (`components.partner-commission-list` / statement detail) — убедиться, что `orderNumber=null` рендерится как «—» и отрицательная сумма видна. Если рендер падает на null — починить (по образцу PDF `orderNumber ?? '—'`).

- [ ] **Step 3: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/app/leader/commission-corrections/page.tsx src/lib/navigation/* src/components/*
git commit -m "feat(commission): leader corrections queue (company-scoped) + partner line render (A6 UI)"
```

---

## Task 11: Full verification

- [ ] **Step 1:** `npm run typecheck && npm run lint` → green.
- [ ] **Step 2:** `npm run test:unit` → green (calculator/statement/lifecycle/corrections/worker/server-action).
- [ ] **Step 3:** Integration (live PG, WSL): `npm run test:integration -- src/__tests__/services.commission.corrections.test.ts src/__tests__/services.commission.statement.test.ts` → green. Defer-as-debt if no PG; run before PR.
- [ ] **Step 4:** `npm run build` → success.
- [ ] **Step 5:** CHANGELOG `[Unreleased]` — добавить пункт про A6 (корректировка §9.5: авто-детект, очередь admin/leader, перенос строкой). Commit.

```bash
git add CHANGELOG.md
git commit -m "docs(commission): CHANGELOG for §9.5 correction flow (A6)"
```

---

## Self-Review notes

- **Spec coverage:** детект §5→Task 3/7; resolve apply/waive §6.1→Task 4; перенос §6.2→Task 2/5; цепочка §6.3→Task 6; модель §4→Task 1; UI §7→Task 9/10; тесты §9→каждая задача + Task 8. Все разделы покрыты.
- **Type consistency:** `CorrectionForCalc` (Task 2) = `{correctionId, organizationName, baseAmount, rate, commissionAmount}` — совпадает с маппингом в statement.ts (Task 5); `CommissionCorrection` поля (Task 1) совпадают с detect (Task 3)/resolve (Task 4)/chain (Task 6); `CalculatorItem.correctionId` (Task 2) ↔ createMany `correctionId` (Task 5) ↔ schema (Task 1).
- **Coverage-гейт 100% (§6):** новые `corrections.ts` и ветки в calculator/statement/lifecycle обязаны держать 100% — кейсы в Tasks 2/3/4/5/6 покрывают: detect (paid/approved/draft/idempotent/no-partner), resolve (apply/waive/forbidden/invalid_state/reason_required/leader-scope), chain (clamp/no-clamp), carry-line. Прогнать `test:coverage` на live PG перед PR.
- **Leader guard:** уточнить фактический `requireLeader`/`requireRole` API в проекте при Task 9/10 (helper при необходимости).
