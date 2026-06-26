# Commission Formula Canon §9.2 (SP-1: A1–A5, A7) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переписать расчёт партнёрской комиссии так, чтобы база считалась от фактических платежей (минус возвраты) по дате `paidAt`, с исторической ставкой партнёра и без вычета НДС.

**Architecture:** Сервис `commission/statement.ts` выбирает `Payment` за период и резолвит ставку на дату каждого платежа (чистый хелпер `rateResolve.ts` по таймлайну `CommissionRateChange`), затем чистый `calculator.ts` считает по строке-на-платёж (`base = amount`, комиссия = `amount × rate`, возвраты — отрицательные строки, итог комиссии зажат в ≥0). Позиция ведомости `CommissionStatementItem` получает nullable `orderId` + `paymentId`.

**Tech Stack:** TypeScript strict, Prisma 5 + PostgreSQL, `Prisma.Decimal` (decimal.js) для денег, Vitest (unit + integration; integration требует живой Postgres — рецепт WSL см. `[[project-wsl-live-pg-verification]]`).

**Спека:** `docs/superpowers/specs/2026-06-26-commission-formula-canon-design.md`

**Ключевые решения владельца (2026-06-26):**
- **НДС НЕ вычитается** из базы: `base = amount` (100000 × 20% = 20000). Отменяет A3 / «без НДС» в §9.2.
- Ставка — **партнёр целиком** (§9.1); калькулятор НЕ читает `Organization.partnerCommissionRate`. Историческая ставка — из `CommissionRateChange`.
- Строка ведомости = **один платёж**. Возвраты — отрицательные строки. Отрицательный нетто-месяц → `totalCommissionAmount = max(0, Σ)` (R2).
- `Organization.partnerCommissionRate` / `partner/rateOverride.ts` в SP-1 **не трогаем** (мёртвый код — отдельное решение).
- A6 (§9.5 корректировка возврат-после-выплаты) — **вне SP-1** (отдельный SP-2).

---

## File Structure

**Создаются:**
- `prisma/migrations/<timestamp>_commission_item_payment/migration.sql` — миграция (orderId nullable + paymentId).
- `src/lib/services/commission/rateResolve.ts` — чистый резолвер ставки на дату по таймлайну.
- `src/__tests__/services.commission.rateResolve.test.ts` — unit для резолвера.

**Изменяются:**
- `prisma/schema.prisma` — `CommissionStatementItem.orderId` nullable + `paymentId` + relation + index.
- `src/lib/services/commission/calculator.ts` — вход `PaymentForCalc[]`, без VAT, строка=платёж, clamp.
- `src/lib/services/commission/statement.ts` — выборка `Payment`, резолв ставки, маппинг позиций; удаление trigger/VAT/order-логики.
- `src/worker/processors/calculate-monthly-commissions.ts` — `activePartners` → партнёры с платежами в периоде.
- `src/lib/services/admin/partners.ts` — `updatePartner` принимает `effectiveFrom?`.
- `src/server-actions/admin/partners.ts` — проброс `effectiveFrom` из формы.
- `src/lib/services/commission/pdf.ts` / `xlsx.ts` — косметика заголовков (платежи вместо заказов).
- Тесты: `commission.calculator.test.ts`, `services.commission.statement.unit.test.ts`, `services.commission.statement.test.ts` (integration), `worker.calculate-monthly-commissions.test.ts`, `server-actions.admin.partners.test.ts` — переписать под платёжную модель.
- `CHANGELOG.md` — запись в `[Unreleased]`.

---

## Task 1: Schema — CommissionStatementItem nullable orderId + paymentId

**Files:**
- Modify: `prisma/schema.prisma:246-260` (model `CommissionStatementItem`) и `model Payment` (добавить обратную связь).
- Create: `prisma/migrations/<timestamp>_commission_item_payment/migration.sql`

- [ ] **Step 1: Edit `CommissionStatementItem` in `prisma/schema.prisma`**

Заменить блок модели (строки ~246-260) на:

```prisma
model CommissionStatementItem {
  id               String              @id @default(cuid())
  statementId      String
  statement        CommissionStatement @relation(fields: [statementId], references: [id])
  orderId          String?
  order            Order?              @relation(fields: [orderId], references: [id])
  paymentId        String?
  payment          Payment?            @relation(fields: [paymentId], references: [id])
  orderNumber      String?
  organizationName String
  baseAmount       Decimal             @db.Decimal(14, 2)
  rate             Decimal             @db.Decimal(6, 4)
  commissionAmount Decimal             @db.Decimal(14, 2)

  @@index([statementId])
  @@index([orderId])
  @@index([paymentId])
}
```

- [ ] **Step 2: Add the back-relation on `Payment`**

В `model Payment` (после строки `enteredBy ...`, перед закрывающей `}` блока полей/индексов) добавить:

```prisma
  commissionItems    CommissionStatementItem[]
```

- [ ] **Step 3: Create the migration SQL by hand**

Создать файл `prisma/migrations/20260626120000_commission_item_payment/migration.sql` (timestamp подставить актуальный, формат `YYYYMMDDHHMMSS`):

```sql
-- CommissionStatementItem: orderId becomes nullable, add paymentId FK
ALTER TABLE "CommissionStatementItem" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "CommissionStatementItem" ADD COLUMN "paymentId" TEXT;

ALTER TABLE "CommissionStatementItem"
  ADD CONSTRAINT "CommissionStatementItem_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CommissionStatementItem_paymentId_idx" ON "CommissionStatementItem"("paymentId");
```

- [ ] **Step 4: Regenerate the Prisma client**

Run: `npm run prisma:generate`
Expected: `Generated Prisma Client` без ошибок; типы `CommissionStatementItem.orderId` теперь `string | null`, добавлено `paymentId`.

- [ ] **Step 5: Typecheck (expected to FAIL — proves the type change propagates)**

Run: `npm run typecheck`
Expected: FAIL в `calculator.ts`/`statement.ts`/`pdf.ts`/`xlsx.ts` или тестах из-за нового nullable/поля. Это ожидаемо — чиним в следующих задачах. (Если хочется зелёного коммита — закоммить только схему+миграцию здесь, typecheck позеленеет к Task 4.)

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(commission): nullable orderId + paymentId on CommissionStatementItem (schema)"
```

---

## Task 2: Calculator — payment-based, no VAT, clamp

**Files:**
- Modify: `src/lib/services/commission/calculator.ts` (полная переработка)
- Test: `src/__tests__/commission.calculator.test.ts` (заменить целиком)

- [ ] **Step 1: Replace the calculator test file**

Полностью заменить `src/__tests__/commission.calculator.test.ts` на:

```ts
import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { calculateCommission, type PaymentForCalc } from '@/lib/services/commission/calculator';

function payment(overrides: Partial<{
  paymentId: string; orderId: string | null; orderNumber: string | null;
  organizationName: string; amount: number | string; isRefund: boolean; rate: number | string;
}> = {}): PaymentForCalc {
  return {
    paymentId: overrides.paymentId ?? 'pay1',
    orderId: overrides.orderId === undefined ? 'o1' : overrides.orderId,
    orderNumber: overrides.orderNumber === undefined ? 'ORD-1' : overrides.orderNumber,
    organizationName: overrides.organizationName ?? 'Org A',
    amount: new Prisma.Decimal(overrides.amount ?? 100000),
    isRefund: overrides.isRefund ?? false,
    rate: new Prisma.Decimal(overrides.rate ?? 0.2),
  };
}

describe('calculateCommission (payment-based)', () => {
  it('returns zero totals for empty list', () => {
    const r = calculateCommission([]);
    expect(r.items).toEqual([]);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(0);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0);
    expect(r.totals.averageRate.toNumber()).toBe(0);
  });

  it('A1/R0: base = full payment amount, VAT never subtracted (100000 × 20% = 20000)', () => {
    const r = calculateCommission([payment({ amount: 100000, rate: 0.2 })]);
    expect(r.items[0].baseAmount.toNumber()).toBe(100000);
    expect(r.items[0].commissionAmount.toNumber()).toBe(20000);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(100000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(20000);
  });

  it('A1: partial payment counted at its actual amount', () => {
    const r = calculateCommission([payment({ amount: 40000, rate: 0.1 })]);
    expect(r.items[0].baseAmount.toNumber()).toBe(40000);
    expect(r.items[0].commissionAmount.toNumber()).toBe(4000);
  });

  it('A1: several payments on one order produce several lines', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', orderId: 'o9', amount: 30000, rate: 0.1 }),
      payment({ paymentId: 'p2', orderId: 'o9', amount: 70000, rate: 0.1 }),
    ]);
    expect(r.items).toHaveLength(2);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(100000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(10000);
  });

  it('A2: refund is a negative line and reduces the base', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', amount: 100000, rate: 0.1 }),
      payment({ paymentId: 'p2', amount: 30000, rate: 0.1, isRefund: true }),
    ]);
    expect(r.items[1].baseAmount.toNumber()).toBe(-30000);
    expect(r.items[1].commissionAmount.toNumber()).toBe(-3000);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(70000);
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(7000);
  });

  it('A2/R2: negative net month clamps total commission to 0 but keeps negative lines', () => {
    const r = calculateCommission([
      payment({ paymentId: 'p1', amount: 10000, rate: 0.1 }),
      payment({ paymentId: 'p2', amount: 50000, rate: 0.1, isRefund: true }),
    ]);
    expect(r.totals.totalBaseAmount.toNumber()).toBe(-40000); // raw base kept
    expect(r.totals.totalCommissionAmount.toNumber()).toBe(0); // payout clamped
    expect(r.items).toHaveLength(2);
    expect(r.items[1].commissionAmount.toNumber()).toBe(-4000); // negative line retained
  });

  it('order-less payment keeps orderId null and computes on full amount', () => {
    const r = calculateCommission([payment({ orderId: null, orderNumber: null, amount: 50000, rate: 0.1 })]);
    expect(r.items[0].orderId).toBeNull();
    expect(r.items[0].commissionAmount.toNumber()).toBe(5000);
  });

  it('exposes paymentId on the item', () => {
    const r = calculateCommission([payment({ paymentId: 'pay-uuid-7' })]);
    expect(r.items[0].paymentId).toBe('pay-uuid-7');
  });

  it('rounds each commission half-up with exact arithmetic (20.70 × 5% = 1.035 → 1.04)', () => {
    const r = calculateCommission([payment({ amount: 20.7, rate: 0.05 })]);
    expect(r.items[0].commissionAmount.toFixed(2)).toBe('1.04');
    expect(r.totals.totalCommissionAmount.toFixed(2)).toBe('1.04');
  });

  it('total equals the exact sum of the rounded line amounts (no re-round drift)', () => {
    const r = calculateCommission([
      payment({ paymentId: 'a', amount: 20.7, rate: 0.05 }),
      payment({ paymentId: 'b', amount: 20.7, rate: 0.05 }),
      payment({ paymentId: 'c', amount: 20.7, rate: 0.05 }),
    ]);
    expect(r.totals.totalCommissionAmount.toFixed(2)).toBe('3.12');
  });

  it('weighted average rate across mixed-rate payments', () => {
    const r = calculateCommission([
      payment({ paymentId: 'a', amount: 100000, rate: 0.1 }),
      payment({ paymentId: 'b', amount: 300000, rate: 0.05 }),
    ]);
    expect(r.totals.averageRate.toNumber()).toBeCloseTo((0.1 * 100000 + 0.05 * 300000) / 400000, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/__tests__/commission.calculator.test.ts`
Expected: FAIL — `PaymentForCalc` не экспортирован / сигнатура старая.

- [ ] **Step 3: Rewrite `src/lib/services/commission/calculator.ts`**

Полностью заменить файл на:

```ts
import { Prisma } from '@prisma/client';

/**
 * Commission calculator — money math end-to-end on Prisma.Decimal (decimal.js),
 * never JS `number`. Каждая строка = один платёж (§9.2). База = полная сумма
 * платежа: НДС НЕ вычитается (решение владельца 2026-06-26, перекрывает «без
 * НДС» в §9.2). Возврат (`isRefund`) — отрицательная строка (A2). Все суммы
 * округляются HALF_UP до копейки; итог комиссии = точная сумма уже округлённых
 * строк, затем зажимается в ≥0 (R2: отрицательный нетто-месяц не уходит в
 * выплату; перенос «минуса» — A6/SP-2). A6 (§9.5) здесь НЕ реализован.
 */

export type PaymentForCalc = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  organizationName: string;
  amount: Prisma.Decimal;
  isRefund: boolean;
  rate: Prisma.Decimal;
};

export type CalculatorItem = {
  paymentId: string;
  orderId: string | null;
  orderNumber: string | null;
  organizationName: string;
  baseAmount: Prisma.Decimal;
  rate: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
};

export type CalculatorTotals = {
  totalBaseAmount: Prisma.Decimal;
  totalCommissionAmount: Prisma.Decimal;
  averageRate: Prisma.Decimal;
};

export type CalculatorResult = {
  items: CalculatorItem[];
  totals: CalculatorTotals;
};

const MONEY_SCALE = 2; // kopecks
const RATE_SCALE = 4; // Decimal(6,4)
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
const ZERO = new Prisma.Decimal(0);

function toMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_SCALE, HALF_UP);
}

export function calculateCommission(payments: PaymentForCalc[]): CalculatorResult {
  const items: CalculatorItem[] = payments.map((p) => {
    const signed = p.isRefund ? p.amount.negated() : p.amount;
    const baseAmount = toMoney(signed);
    const commissionAmount = toMoney(baseAmount.mul(p.rate));
    return {
      paymentId: p.paymentId,
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      organizationName: p.organizationName,
      baseAmount,
      rate: p.rate,
      commissionAmount,
    };
  });

  const totalBaseAmount = items.reduce((sum, i) => sum.plus(i.baseAmount), ZERO);
  const rawCommission = items.reduce((sum, i) => sum.plus(i.commissionAmount), ZERO);
  // R2: отрицательный нетто-месяц не уходит в выплату.
  const totalCommissionAmount = rawCommission.lt(0) ? ZERO : rawCommission;

  // Взвешенная по базе средняя ставка; guard на неположительную базу.
  const weightedRateSum = items.reduce((sum, i) => sum.plus(i.rate.mul(i.baseAmount)), ZERO);
  const averageRate = totalBaseAmount.gt(0)
    ? weightedRateSum.div(totalBaseAmount).toDecimalPlaces(RATE_SCALE, HALF_UP)
    : ZERO;

  return { items, totals: { totalBaseAmount, totalCommissionAmount, averageRate } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/__tests__/commission.calculator.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/calculator.ts src/__tests__/commission.calculator.test.ts
git commit -m "feat(commission): payment-based calculator, no VAT, refund lines, clamp (A1/A2/R0/R2)"
```

---

## Task 3: Rate resolver — historical rate by paidAt (A5)

**Files:**
- Create: `src/lib/services/commission/rateResolve.ts`
- Test: `src/__tests__/services.commission.rateResolve.test.ts`

- [ ] **Step 1: Write the failing test**

Создать `src/__tests__/services.commission.rateResolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveRateAt, type RateChange } from '@/lib/services/commission/rateResolve';

const d = (s: string) => new Date(s);
const dec = (n: number | string) => new Prisma.Decimal(n);

describe('resolveRateAt', () => {
  const partnerDefault = dec(0.1);

  it('returns partner default when there are no changes', () => {
    expect(resolveRateAt([], d('2026-04-10'), partnerDefault).toNumber()).toBe(0.1);
  });

  it('A5: picks the latest change with effectiveFrom <= paidAt', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
      { effectiveFrom: d('2026-04-15'), oldRate: dec(0.05), newRate: dec(0.2) },
    ];
    // before the 15th → 0.05; on/after the 15th → 0.2
    expect(resolveRateAt(changes, d('2026-04-14T23:59:59Z'), partnerDefault).toNumber()).toBe(0.05);
    expect(resolveRateAt(changes, d('2026-04-15T00:00:00Z'), partnerDefault).toNumber()).toBe(0.2);
    expect(resolveRateAt(changes, d('2026-04-20'), partnerDefault).toNumber()).toBe(0.2);
  });

  it('before all changes: falls back to earliest change oldRate when present', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: dec(0.07), newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-01-01'), partnerDefault).toNumber()).toBe(0.07);
  });

  it('before all changes with null oldRate: falls back to partner default', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-03-01'), oldRate: null, newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-01-01'), partnerDefault).toNumber()).toBe(0.1);
  });

  it('does not assume input order (sorts internally)', () => {
    const changes: RateChange[] = [
      { effectiveFrom: d('2026-04-15'), oldRate: dec(0.05), newRate: dec(0.2) },
      { effectiveFrom: d('2026-01-01'), oldRate: null, newRate: dec(0.05) },
    ];
    expect(resolveRateAt(changes, d('2026-02-01'), partnerDefault).toNumber()).toBe(0.05);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.commission.rateResolve.test.ts`
Expected: FAIL — модуль не существует.

- [ ] **Step 3: Implement `src/lib/services/commission/rateResolve.ts`**

```ts
import { Prisma } from '@prisma/client';

/**
 * A5 (§9.1): историческая ставка партнёра. Резолвит ставку, действовавшую на
 * момент `paidAt`, по таймлайну `CommissionRateChange`. Чистая функция — без
 * Prisma-запросов, тестируется без БД.
 */
export type RateChange = {
  effectiveFrom: Date;
  oldRate: Prisma.Decimal | null;
  newRate: Prisma.Decimal;
};

export function resolveRateAt(
  changes: RateChange[],
  paidAt: Date,
  partnerDefault: Prisma.Decimal
): Prisma.Decimal {
  if (changes.length === 0) return partnerDefault;
  const asc = [...changes].sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());

  let resolved: Prisma.Decimal | null = null;
  for (const c of asc) {
    if (c.effectiveFrom.getTime() <= paidAt.getTime()) resolved = c.newRate;
    else break;
  }
  if (resolved !== null) return resolved;

  // paidAt раньше всех записей: ставка до первой смены = её oldRate, иначе дефолт.
  return asc[0].oldRate ?? partnerDefault;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/services.commission.rateResolve.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/services/commission/rateResolve.ts src/__tests__/services.commission.rateResolve.test.ts
git commit -m "feat(commission): historical rate resolver by paidAt (A5)"
```

---

## Task 4: Statement builder — select Payments, resolve rate, map items

**Files:**
- Modify: `src/lib/services/commission/statement.ts`
- Test: `src/__tests__/services.commission.statement.unit.test.ts` (заменить)
- Test: `src/__tests__/services.commission.statement.test.ts` (integration — переписать выборку под платежи)

- [ ] **Step 1: Rewrite the unit test file**

Полностью заменить `src/__tests__/services.commission.statement.unit.test.ts` на следующий (удаляются все trigger/VAT/org-override/resolveRatesAndOrgNames кейсы — этой логики больше нет; сохраняются draft/supersede/race/audit/queue инварианты, переведённые на платёжную выборку):

```ts
/**
 * Unit tests for commission/statement.ts (mocked prisma, no live Postgres).
 * Платёжная модель: db.payment.findMany + db.commissionRateChange.findMany.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { recordAudit, getQueue, queueAdd } = vi.hoisted(() => {
  const queueAdd = vi.fn().mockResolvedValue({});
  const getQueue = vi.fn(() => ({ add: queueAdd }));
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  return { recordAudit, getQueue, queueAdd };
});
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { Prisma } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

const PERIOD_FROM = new Date('2026-04-01T00:00:00Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59Z');

function makeTx() {
  return {
    commissionStatementItem: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    commissionStatement: {
      update: vi.fn().mockResolvedValue({ id: 'stmt-1', status: 'draft', pdfPath: null, xlsxPath: null }),
      create: vi.fn().mockResolvedValue({ id: 'stmt-new', status: 'draft' }),
    },
  };
}

type DbOpts = {
  partner?: unknown;
  payments?: unknown[];
  rateChanges?: unknown[];
  existing?: unknown;
  findFirstQueue?: unknown[];
  tx?: ReturnType<typeof makeTx>;
  $transaction?: ReturnType<typeof vi.fn>;
};

function makeDb(o: DbOpts = {}) {
  const tx = o.tx ?? makeTx();
  const findFirst = vi.fn();
  if (o.findFirstQueue) {
    for (const v of o.findFirstQueue) findFirst.mockResolvedValueOnce(v);
  } else {
    findFirst.mockResolvedValue(o.existing ?? null);
  }
  return {
    partner: { findUnique: vi.fn().mockResolvedValue(o.partner ?? { commissionRate: new Prisma.Decimal('0.1') }) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(o.rateChanges ?? []) },
    payment: { findMany: vi.fn().mockResolvedValue(o.payments ?? []) },
    commissionStatement: { findFirst, create: tx.commissionStatement.create, update: tx.commissionStatement.update },
    $transaction: o.$transaction ?? vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

function paymentRow(over: Record<string, unknown> = {}) {
  return {
    id: 'pay1', amount: new Prisma.Decimal('100000'), paidAt: new Date('2026-04-10T00:00:00Z'),
    isRefund: false, orderId: 'o1',
    order: { orderNumber: 'N1', partnerId: 'p1' },
    organization: { name: 'Org A', partnerId: 'p1' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REDIS_URL;
});
afterEach(() => {
  delete process.env.REDIS_URL;
});

describe('calculateStatementForPartner — unit (payment model)', () => {
  it('throws PARTNER_NOT_FOUND when partner missing', async () => {
    const db = makeDb({ partner: null });
    await expect(calculateStatementForPartner(db as never, {
      partnerId: 'x', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    })).rejects.toThrow('PARTNER_NOT_FOUND');
  });

  it('creates new draft with 0 items when no payments', async () => {
    const db = makeDb();
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(r.isNew).toBe(true);
    expect(r.itemCount).toBe(0);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('maps a payment into an item with paymentId and resolved rate', async () => {
    const db = makeDb({ payments: [paymentRow()] });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(r.itemCount).toBe(1);
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(data.paymentId).toBe('pay1');
    expect(data.orderId).toBe('o1');
    expect(Number(data.commissionAmount)).toBe(10000); // 100000 * 0.1
    expect(data.organizationName).toBe('Org A');
  });

  it('order-less payment maps orderId=null and uses organization name', async () => {
    const db = makeDb({ payments: [paymentRow({ orderId: null, order: null })] });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    const data = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data[0];
    expect(data.orderId).toBeNull();
    expect(data.orderNumber).toBeNull();
    expect(data.organizationName).toBe('Org A');
    expect(r.itemCount).toBe(1);
  });

  it('A5: applies historical rate by paidAt', async () => {
    const db = makeDb({
      payments: [
        paymentRow({ id: 'pBefore', paidAt: new Date('2026-04-10'), amount: new Prisma.Decimal('100000') }),
        paymentRow({ id: 'pAfter', paidAt: new Date('2026-04-20'), amount: new Prisma.Decimal('100000') }),
      ],
      rateChanges: [
        { effectiveFrom: new Date('2026-01-01'), oldRate: null, newRate: new Prisma.Decimal('0.05') },
        { effectiveFrom: new Date('2026-04-15'), oldRate: new Prisma.Decimal('0.05'), newRate: new Prisma.Decimal('0.2') },
      ],
    });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    const rows = db._tx.commissionStatementItem.createMany.mock.calls[0][0].data;
    const before = rows.find((x: { paymentId: string }) => x.paymentId === 'pBefore');
    const after = rows.find((x: { paymentId: string }) => x.paymentId === 'pAfter');
    expect(Number(before.commissionAmount)).toBe(5000);  // 0.05
    expect(Number(after.commissionAmount)).toBe(20000);  // 0.2
  });

  it('writes audit when calculatedByUserId provided', async () => {
    const db = makeDb({ payments: [paymentRow()] });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: 'u-admin',
    });
    expect(recordAudit).toHaveBeenCalledOnce();
    expect(recordAudit.mock.calls[0][1]).toMatchObject({ userId: 'u-admin', action: 'commission_statement_calculated' });
  });

  it('enqueues PDF/XLSX when REDIS_URL set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const db = makeDb({ payments: [paymentRow()] });
    await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionPdf');
    expect(getQueue).toHaveBeenCalledWith('docs.generateCommissionXlsx');
    expect(queueAdd).toHaveBeenCalledTimes(2);
  });

  it('swallows queue errors', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    queueAdd.mockRejectedValue(new Error('Redis down'));
    const db = makeDb({ payments: [paymentRow()] });
    await expect(calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    })).resolves.toBeDefined();
  });

  it('updates draft in place when existing draft found (isNew=false)', async () => {
    const db = makeDb({ existing: { id: 'stmt-draft', status: 'draft', supersededBy: null } });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(r.isNew).toBe(false);
    expect(r.statement.id).toBe('stmt-draft');
  });

  it('creates new + supersedes when existing is approved', async () => {
    const tx = makeTx();
    tx.commissionStatement.create.mockResolvedValue({ id: 'stmt-new', status: 'draft' });
    tx.commissionStatement.update.mockResolvedValue({ id: 'stmt-old', supersededBy: 'stmt-new' });
    const db = makeDb({ existing: { id: 'stmt-old', status: 'approved', supersededBy: null }, tx });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(r.isNew).toBe(true);
    expect(r.statement.id).toBe('stmt-new');
    expect(tx.commissionStatement.update).toHaveBeenCalledTimes(2);
  });

  it('throws PERIOD_OVERLAP when rejectOverlap and a different range overlaps', async () => {
    const db = makeDb({ findFirstQueue: [{ id: 'stmt-other' }] });
    await expect(calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null, rejectOverlap: true,
    })).rejects.toThrow(/PERIOD_OVERLAP/);
  });

  it('C-01 race: falls back to updateDraftInPlace on P2002', async () => {
    const tx = makeTx();
    tx.commissionStatement.update.mockResolvedValue({ id: 'stmt-winner', status: 'draft', pdfPath: null, xlsxPath: null });
    const uniqueError = Object.assign(new Error('Unique'), { code: 'P2002' });
    const $transaction = vi.fn()
      .mockRejectedValueOnce(uniqueError)
      .mockImplementationOnce(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const db = makeDb({
      tx, $transaction,
      findFirstQueue: [null /*existing lookup*/, { id: 'stmt-winner', status: 'draft', supersededBy: null } /*winner*/],
    });
    const r = await calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    });
    expect(r.isNew).toBe(false);
    expect(r.statement.id).toBe('stmt-winner');
  });

  it('C-01 race: re-throws non-P2002', async () => {
    const $transaction = vi.fn().mockRejectedValue(new Error('Network'));
    const db = makeDb({ $transaction });
    await expect(calculateStatementForPartner(db as never, {
      partnerId: 'p1', periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
    })).rejects.toThrow('Network');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.commission.statement.unit.test.ts`
Expected: FAIL — `statement.ts` всё ещё запрашивает `order.findMany`/`organization.findMany`, нет `payment.findMany`/`commissionRateChange.findMany`.

- [ ] **Step 3: Rewrite the query/mapping in `src/lib/services/commission/statement.ts`**

Внести изменения:

(a) Заменить импорт калькулятора и удалить env-хелперы. Вверху файла:

```ts
import type { PrismaClient, CommissionStatement } from '@prisma/client';
import { calculateCommission, type PaymentForCalc } from './calculator';
import { resolveRateAt, type RateChange } from './rateResolve';
import { getQueue } from '@/lib/jobs/queues';
import { recordAudit } from '@/lib/auth/audit';
```

(b) Удалить целиком: `getTrigger`, `getVatMode`, `buildOrdersWhere`, тип `OrderWithCompany`, `resolveRatesAndOrgNames`, экспорт `CommissionTrigger`. (Тип `Prisma` импорт оставить, если нужен в `updateDraftInPlace` — он использует `ReturnType<typeof calculateCommission>`, `Prisma` там не требуется; убрать неиспользуемый импорт `Prisma`.)

(c) `updateDraftInPlace` и блок `create` маппят позиции с новыми полями. В обоих местах в `data: calc.items.map((item) => ({ ... }))` заменить тело на:

```ts
          statementId, // (в create — created.id)
          orderId: item.orderId,
          paymentId: item.paymentId,
          orderNumber: item.orderNumber,
          organizationName: item.organizationName,
          baseAmount: item.baseAmount,
          rate: item.rate,
          commissionAmount: item.commissionAmount,
```

(d) В `calculateStatementForPartner`, после загрузки партнёра, заменить блок выборки заказов и `resolveRatesAndOrgNames` на выборку платежей + резолв ставки:

```ts
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { commissionRate: true },
  });
  if (!partner) throw new Error('PARTNER_NOT_FOUND');
  const partnerDefaultRate = partner.commissionRate;

  // ... (блок rejectOverlap остаётся без изменений) ...

  const rateChanges: RateChange[] = await prisma.commissionRateChange.findMany({
    where: { partnerId },
    select: { effectiveFrom: true, oldRate: true, newRate: true },
    orderBy: { effectiveFrom: 'asc' },
  });

  // A1/A4: фактические платежи за период по paidAt, отнесённые этому партнёру.
  // Партнёр платежа = order?.partnerId ?? organization.partnerId.
  const payments = await prisma.payment.findMany({
    where: {
      paidAt: { gte: periodFrom, lte: periodTo },
      OR: [
        { order: { partnerId } },
        { order: { partnerId: null }, organization: { partnerId } },
        { orderId: null, organization: { partnerId } },
      ],
    },
    select: {
      id: true,
      amount: true,
      paidAt: true,
      isRefund: true,
      orderId: true,
      order: { select: { orderNumber: true, partnerId: true } },
      organization: { select: { name: true, partnerId: true } },
    },
    orderBy: { paidAt: 'asc' },
  });

  const paymentInputs: PaymentForCalc[] = payments.map((p) => ({
    paymentId: p.id,
    orderId: p.orderId,
    orderNumber: p.order?.orderNumber ?? null,
    organizationName: p.organization.name,
    amount: p.amount,
    isRefund: p.isRefund,
    rate: resolveRateAt(rateChanges, p.paidAt, partnerDefaultRate),
  }));

  const calc = calculateCommission(paymentInputs);
```

(Остальное — `existing` lookup, draft/create/supersede, audit, enqueue — без изменений.)

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `npx vitest run src/__tests__/services.commission.statement.unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the integration test to use Payments**

В `src/__tests__/services.commission.statement.test.ts` заменить helper `createPaidOrder` и кейсы так, чтобы создавался заказ + платёж(и). Минимальный набор кейсов (полностью заменить тело describe — сохранить beforeAll/afterAll/beforeEach структуру; в `beforeEach` ДОБАВИТЬ очистку платежей):

В `beforeEach` добавить первой строкой:
```ts
  await prisma.payment.deleteMany({ where: { OR: [{ order: { partnerId } }, { organizationId: orgId }] } });
```

Helper-функции:
```ts
async function createOrder(amount: number) {
  return prisma.order.create({
    data: {
      title: 'T', companyId, organizationId: orgId, partnerId,
      totalAmount: amount, financialStatus: 'paid',
    },
  });
}
async function pay(orderId: string | null, amount: number, paidAt: Date, isRefund = false) {
  return prisma.payment.create({
    data: { organizationId: orgId, orderId, amount, paidAt, isRefund },
  });
}
```

Кейсы (each `it`):
```ts
it('A1: base from actual payments, not order total', async () => {
  const o = await createOrder(100000);
  await pay(o.id, 40000, new Date('2026-04-10'));
  const r = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  expect(r.itemCount).toBe(1);
  expect(Number(r.statement.totalBaseAmount)).toBe(40000);
  expect(Number(r.statement.totalCommissionAmount)).toBe(4000); // 0.1
});

it('A4: payment dated by paidAt, not order closedAt (req 31 Mar, paid 2 Apr → April)', async () => {
  const o = await createOrder(100000);
  await pay(o.id, 100000, new Date('2026-04-02'));
  const r = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  expect(r.itemCount).toBe(1);
  // a payment dated in March must NOT appear in the April statement
  const o2 = await createOrder(50000);
  await pay(o2.id, 50000, new Date('2026-03-31'));
  const r2 = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  expect(Number(r2.statement.totalBaseAmount)).toBe(100000); // March payment excluded
});

it('A1: order-less org-level payment attributed via organization.partnerId', async () => {
  await pay(null, 25000, new Date('2026-04-12'));
  const r = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  expect(r.itemCount).toBe(1);
  expect(Number(r.statement.totalBaseAmount)).toBe(25000);
});

it('A2: refund in period reduces the base', async () => {
  const o = await createOrder(100000);
  await pay(o.id, 100000, new Date('2026-04-05'));
  await pay(o.id, 30000, new Date('2026-04-20'), true);
  const r = await calculateStatementForPartner(prisma, {
    partnerId, periodFrom: PERIOD_FROM, periodTo: PERIOD_TO, calculatedByUserId: null,
  });
  expect(Number(r.statement.totalBaseAmount)).toBe(70000);
  expect(Number(r.statement.totalCommissionAmount)).toBe(7000);
});
```

- [ ] **Step 6: Run the integration test (live Postgres required)**

Run (через WSL live-PG путь, см. `[[project-wsl-live-pg-verification]]`): `npm run test:integration -- src/__tests__/services.commission.statement.test.ts`
Expected: PASS. (Если живой PG недоступен на этой машине — отметить как отложенный долг и прогнать перед PR.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/commission/statement.ts src/__tests__/services.commission.statement.unit.test.ts src/__tests__/services.commission.statement.test.ts
git commit -m "feat(commission): payment-based statement builder + historical rate (A1/A4/A5)"
```

---

## Task 5: Worker — pick partners with payments in the period

**Files:**
- Modify: `src/worker/processors/calculate-monthly-commissions.ts:39-42`
- Test: `src/__tests__/worker.calculate-monthly-commissions.test.ts`

- [ ] **Step 1: Update the worker test's prisma mock + intent**

В `src/__tests__/worker.calculate-monthly-commissions.test.ts` заменить `makePrisma` так, чтобы вместо `partner.findMany` мокался путь выбора партнёров по платежам, и обновить кейс-название:

```ts
function makePrisma(partnerIds: { id: string }[]) {
  return {
    payment: {
      findMany: vi.fn().mockResolvedValue(
        partnerIds.map((p) => ({ order: { partnerId: p.id }, organization: { partnerId: null } }))
      ),
    },
    syncLog: { create: vi.fn().mockResolvedValue({}) },
  } as any;
}
```

И переименовать первый кейс:
```ts
  it('processes each partner that has payments in the period', async () => {
    const db = makePrisma([{ id: 'p1' }, { id: 'p2' }]);
    mockCalc.mockResolvedValue({ statement: {}, itemCount: 5, isNew: true });
    const result = await calculateMonthlyCommissionsProcessor(makeJob(), db);
    expect(mockCalc).toHaveBeenCalledTimes(2);
    expect(result.partnersProcessed).toBe(2);
  });
```

(Остальные кейсы оставить; они зависят от того, что `makePrisma` возвращает 1-2 партнёров — после правки `makePrisma` они продолжат работать, так как процессор выведет distinct partnerId.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/worker.calculate-monthly-commissions.test.ts`
Expected: FAIL — процессор ещё зовёт `db.partner.findMany`.

- [ ] **Step 3: Update `calculate-monthly-commissions.ts`**

Заменить блок `activePartners` (строки ~39-42) на выбор distinct партнёров из платежей периода:

```ts
  // Партнёры, у кого есть хотя бы один платёж в периоде (по paidAt). При истории
  // ставок текущая ставка 0 ≠ ноль заработка в периоде, поэтому фильтр по
  // commissionRate>0 заменён на «есть платёж».
  const paymentRows = await db.payment.findMany({
    where: { paidAt: { gte: periodFrom, lte: periodTo } },
    select: { order: { select: { partnerId: true } }, organization: { select: { partnerId: true } } },
  });
  const partnerIdSet = new Set<string>();
  for (const p of paymentRows) {
    const pid = p.order?.partnerId ?? p.organization?.partnerId ?? null;
    if (pid) partnerIdSet.add(pid);
  }
  const activePartners = Array.from(partnerIdSet).map((id) => ({ id }));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/__tests__/worker.calculate-monthly-commissions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/worker/processors/calculate-monthly-commissions.ts src/__tests__/worker.calculate-monthly-commissions.test.ts
git commit -m "feat(commission): monthly cron picks partners by payments in period"
```

---

## Task 6: Admin — backdate rate change via effectiveFrom (A5 enablement)

**Files:**
- Modify: `src/lib/services/admin/partners.ts:146-210` (`UpdatePartnerArgs`, `updatePartner`)
- Modify: `src/server-actions/admin/partners.ts:92-115` (`updateSchema`, `updatePartnerAction`)
- Test: `src/__tests__/services.admin.partners.test.ts` (добавить кейс)
- Modify: `src/components/admin/partner-edit-form.tsx` (минимальный date input)

- [ ] **Step 1: Write a failing service test**

В `src/__tests__/services.admin.partners.test.ts` добавить тест, что переданный `effectiveFrom` пишется в `commissionRateChange.create`:

```ts
it('updatePartner writes commissionRateChange with provided effectiveFrom (backdate)', async () => {
  const eff = new Date('2026-04-15T00:00:00Z');
  const created: { effectiveFrom?: Date } = {};
  const tx = {
    partner: {
      findUnique: vi.fn().mockResolvedValue({ name: 'P', commissionRate: new Prisma.Decimal('0.1'), isActive: true }),
      update: vi.fn().mockResolvedValue({ name: 'P', commissionRate: new Prisma.Decimal('0.2'), isActive: true }),
    },
    commissionRateChange: { create: vi.fn().mockImplementation(({ data }) => { created.effectiveFrom = data.effectiveFrom; return {}; }) },
  };
  const db = { $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) } as never;
  // recordAudit мокается на уровне модуля (см. существующие мок-паттерны файла)
  await updatePartner(db, 'admin-1', 'p1', { commissionRate: 0.2, effectiveFrom: eff });
  expect(created.effectiveFrom).toEqual(eff);
});
```

(Импорт `updatePartner` и `Prisma`, и мок `@/lib/auth/audit`/`@/lib/auth/passwordReset` — по образцу существующих тестов admin/partners.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/__tests__/services.admin.partners.test.ts`
Expected: FAIL — `effectiveFrom` не в `UpdatePartnerArgs`, не передаётся в `create`.

- [ ] **Step 3: Extend `UpdatePartnerArgs` + `updatePartner`**

В `src/lib/services/admin/partners.ts`:

```ts
export type UpdatePartnerArgs = {
  name?: string;
  commissionRate?: number | null;
  isActive?: boolean;
  effectiveFrom?: Date; // A5: дата вступления ставки; default now()
};
```

В блоке создания `commissionRateChange` внутри `updatePartner` добавить `effectiveFrom`:

```ts
        await tx.commissionRateChange.create({
          data: {
            partnerId: id,
            oldRate: before.commissionRate ?? null,
            newRate: newDec,
            effectiveFrom: args.effectiveFrom ?? new Date(),
            changedById: actorUserId,
          },
        });
```

- [ ] **Step 4: Thread `effectiveFrom` through the server-action**

В `src/server-actions/admin/partners.ts`: расширить `updateSchema` (рядом с `commissionRate`) полем и распарсить:

```ts
// в updateSchema:
  effectiveFrom: z.string().optional(),
```
```ts
// в updatePartnerAction, после readField'ов:
    effectiveFrom: readField(fd, 'effectiveFrom') || undefined,
```
```ts
// в построении args:
    const args = {
      ...raw,
      commissionRate: raw.commissionRate != null ? raw.commissionRate / 100 : raw.commissionRate,
      effectiveFrom: raw.effectiveFrom ? new Date(raw.effectiveFrom) : undefined,
    };
```

(Если в `raw` попадает строка `effectiveFrom` — она преобразуется в `Date`; пустое поле → `undefined` → сервис подставит `now()`.)

- [ ] **Step 5: Add a minimal date input to the admin partner edit form**

В `src/components/admin/partner-edit-form.tsx`, рядом с полем `name="commissionRate"`, добавить:

```tsx
<label>
  Дата вступления ставки
  <input type="date" name="effectiveFrom" />
</label>
```

(Поле необязательное; пустое = «с текущего момента».)

- [ ] **Step 6: Run the tests + typecheck**

Run: `npx vitest run src/__tests__/services.admin.partners.test.ts src/__tests__/server-actions.admin.partners.test.ts`
Run: `npm run typecheck`
Expected: PASS / no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/admin/partners.ts src/server-actions/admin/partners.ts src/components src/app src/__tests__/services.admin.partners.test.ts
git commit -m "feat(commission): admin can backdate rate change via effectiveFrom (A5 enablement)"
```

---

## Task 7: PDF / XLSX — relabel for payments

**Files:**
- Modify: `src/lib/services/commission/pdf.ts:90` (section label), `:99-104` (col headers if desired)
- Modify: `src/lib/services/commission/xlsx.ts:40-47`

> Рендереры уже терпят `orderNumber ?? '—'` и отрицательные суммы — структурных правок не нужно. Только косметика заголовков.

- [ ] **Step 1: Relabel the PDF section + base column**

В `pdf.ts`:
- строка ~90: `'Детализация заказов'` → `'Детализация платежей'`.
- строка ~102/103: заголовок колонки `'База, ₽'` оставить; заголовок `'Заказ'` → `'Заказ / платёж'` (опционально).

- [ ] **Step 2: Relabel the XLSX columns**

В `xlsx.ts` (строки ~40-47): заголовок `'Заказ'` → `'Заказ / платёж'` (опционально). `'База, ₽'` оставить.

- [ ] **Step 3: Run the PDF/XLSX tests**

Run: `npx vitest run src/__tests__/services.commission.pdf.test.ts src/__tests__/services.commission.pdf.unit2.test.ts src/__tests__/services.commission.xlsx.test.ts src/__tests__/services.commission.xlsx.unit2.test.ts`
Expected: PASS. Если какой-то snapshot/строковый ассерт завязан на `'Детализация заказов'` — обновить ожидание в тесте на `'Детализация платежей'`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/commission/pdf.ts src/lib/services/commission/xlsx.ts src/__tests__/services.commission.pdf.test.ts src/__tests__/services.commission.xlsx.test.ts
git commit -m "chore(commission): relabel PDF/XLSX for payment lines"
```

---

## Task 8: Docs — module headers + CHANGELOG (A7)

**Files:**
- Modify: `src/lib/services/commission/calculator.ts` (шапка уже написана в Task 2 — проверить), `statement.ts` (добавить шапку)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Add a module doc header to `statement.ts`**

В начало `src/lib/services/commission/statement.ts` (перед импортами) добавить:

```ts
/**
 * Формирование комиссионной ведомости (§9.2). База партнёра за период =
 * Σ фактических платежей − Σ возвратов по дате `paidAt`; комиссия = база ×
 * ставка, действовавшая на дату платежа (`CommissionRateChange`, см.
 * rateResolve.ts). НДС НЕ вычитается (решение владельца 2026-06-26). Период —
 * календарный месяц по `paidAt`. Корректировка возврат-после-выплаты (§9.5/A6)
 * здесь НЕ реализована — это отдельный SP-2.
 */
```

- [ ] **Step 2: Add a CHANGELOG entry**

В `CHANGELOG.md`, в секции `[Unreleased]` → `### Изменено` добавить пункт:

```markdown
- **Расчёт комиссии переведён на фактические платежи (§9.2).** База партнёра за
  период = Σ полученных платежей − Σ возвратов по дате `paidAt` (раньше — сумма
  заказа по `closedAt`); комиссия по ставке, действовавшей на дату платежа
  (`CommissionRateChange`); НДС из базы **не вычитается** (решение владельца).
  Строка ведомости = один платёж (`CommissionStatementItem.orderId` стал
  nullable, добавлен `paymentId`); возвраты — отрицательные строки, отрицательный
  нетто-месяц не уходит в выплату. ⚠️ Поведенческое изменение сумм выплат.
  Удалены env-рычаги `COMMISSION_TRIGGER` / `COMMISSION_VAT_MODE`. Корректировка
  возврат-после-выплаты (§9.5) — отдельный следующий sub-project.
```

- [ ] **Step 3: Grep for now-removed env vars and dangling references**

Run: `grep -rn "COMMISSION_TRIGGER\|COMMISSION_VAT_MODE\|OrderForCalc\|resolveRatesAndOrgNames" src .env.example`
Expected: только память/доки; в `src/**` — пусто (кроме, возможно, `.env.example` — удалить эти строки, если есть).

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/commission/statement.ts CHANGELOG.md .env.example
git commit -m "docs(commission): module headers + CHANGELOG for §9.2 payment-based formula (A7)"
```

---

## Task 9: Full verification

- [ ] **Step 1: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: оба зелёные.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:unit`
Expected: PASS. Ожидаемые правки тестов уже сделаны в задачах 2/4/5/6/7. Если падает `worker.processor-coverage.guardrail` — проверить, что у процессора есть интеграционный тест (он есть).

- [ ] **Step 3: Integration suite (live Postgres — WSL recipe)**

Run: `npm run test:integration -- src/__tests__/services.commission.statement.test.ts`
Expected: PASS на живом PG (ICU-collation БД — см. `[[project-postgres-icu-collation-2026-06-14]]`). Если PG недоступен локально — зафиксировать как отложенный долг и прогнать перед PR.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: успешная сборка.

- [ ] **Step 5: Final commit (if any verification fixups)**

```bash
git add -A
git commit -m "test(commission): verification fixups for §9.2 formula"
```

---

## Self-Review notes (для исполнителя)

- **Покрытие спеки:** A1→Task 2/4; A2→Task 2/4; A4→Task 4; A5→Task 3/4/6; A7→Task 8; схема→Task 1; worker→Task 5; R0/R2→Task 2. A3 умышленно отменён (R0). A6 — не в этом плане.
- **Типы согласованы:** `PaymentForCalc`/`CalculatorItem.paymentId`/`orderId: string|null` (Task 2) совпадают с маппингом в `statement.ts` (Task 4) и схемой (Task 1); `RateChange` (Task 3) совпадает с `select` в `statement.ts` (Task 4).
- **Coverage-гейт 100% (CLAUDE.md §6):** новые файлы `rateResolve.ts` и переписанные `calculator.ts`/`statement.ts` обязаны держать 100% L/B/F/S на логических глобах — кейсы в задачах 2/3/4 покрывают все ветки (пустой список, refund, clamp, fallback'ы резолвера, draft/supersede/race). Перед PR прогнать `npm run test:coverage` на живом PG.
- **Откат env:** `COMMISSION_TRIGGER`/`COMMISSION_VAT_MODE` удалены — проверить `.env.example`/доки в Task 8.
