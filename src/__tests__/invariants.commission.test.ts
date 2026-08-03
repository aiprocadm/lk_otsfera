/**
 * Инвариант-тесты домена «комиссия» — «исполняемое ТЗ» (фаза 6).
 *
 * Каждый describe/it назван формулировкой требования из действующего ТЗ
 * [docs/tz/2026-07-29-tz-lk-otsfera-v0.5.md] и обязан ПАДАТЬ при развороте
 * соответствующего решения в исходнике. Это не алиасы существующих тестов —
 * самостоятельные проверки семантики.
 *
 * Откуда инварианты:
 *   1. §9.2 + §23 «Журнал разворотов» (2026-06-26): «База = полная сумма
 *      платежа, НДС НЕ вычитается». Поле vatAmount хранится справочно и на
 *      базу комиссии не влияет.
 *   2. §9.1 + §23 (2026-06-26): «Приоритет резолвинга ставки:
 *      override организации → историческая ставка партнёра на дату платежа →
 *      дефолтная ставка партнёра».
 *   3. §9.1 (тот же разворот): «Cross-partner gate: индивидуальная ставка по
 *      чужой организации не протекает на другого партнёра».
 *
 * Инвариант 4 (идемпотентность «один paidAt = один факт выплаты») — в
 * integration-файле invariants.commission.integration.test.ts (нужен живой
 * Postgres: модель идемпотентности держится на partial-unique индексе
 * «один живой statement на (partner, period)»).
 *
 * Слой unit: чистые функции rateResolve + statement.ts на мокнутой prisma
 * (mock-паттерн переиспользован из services.commission.statement.unit.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { recordAudit, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn().mockResolvedValue({});
  const getQueue = vi.fn(() => ({ add: queueAdd }));
  const recordAudit = vi.fn().mockResolvedValue(undefined);
  return { recordAudit, getQueue };
});
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { Prisma } from '@prisma/client';
import { resolveEffectiveRate, resolveRateAt } from '@/lib/services/commission/rateResolve';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';

const D = (v: string | number) => new Prisma.Decimal(v);

const PERIOD_FROM = new Date('2026-04-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-04-30T23:59:59.999Z');
// Партнёрский таймлайн: дефолт 0.10, смена на 0.20 с 2026-04-15.
const RATE_CHANGE_FROM = new Date('2026-04-15T00:00:00.000Z');
const PAID_BEFORE_CHANGE = new Date('2026-04-10T00:00:00.000Z');
const PAID_AFTER_CHANGE = new Date('2026-04-20T00:00:00.000Z');
const PARTNER_DEFAULT = D('0.1');
const PARTNER_NEW_RATE = D('0.2');
const PARTNER_CHANGES = [
  { effectiveFrom: RATE_CHANGE_FROM, oldRate: PARTNER_DEFAULT, newRate: PARTNER_NEW_RATE },
];

// ── Мок prisma для statement.ts (переиспользованный паттерн unit-теста statement) ──

type CreatedItem = {
  paymentId: string | null;
  baseAmount: Prisma.Decimal;
  rate: Prisma.Decimal;
  commissionAmount: Prisma.Decimal;
};

function makeDb(o: { payments?: unknown[]; rateChanges?: unknown[]; orgRateChanges?: unknown[] }) {
  const tx = {
    commissionStatementItem: {
      deleteMany: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({}),
    },
    commissionStatement: {
      update: vi.fn().mockResolvedValue({ id: 'stmt-1', status: 'draft' }),
      create: vi.fn().mockResolvedValue({ id: 'stmt-1', status: 'draft' }),
    },
  };
  return {
    partner: { findUnique: vi.fn().mockResolvedValue({ commissionRate: PARTNER_DEFAULT }) },
    commissionRateChange: { findMany: vi.fn().mockResolvedValue(o.rateChanges ?? []) },
    organizationCommissionRateChange: {
      findMany: vi.fn().mockResolvedValue(o.orgRateChanges ?? []),
    },
    payment: { findMany: vi.fn().mockResolvedValue(o.payments ?? []) },
    commissionCorrection: { findMany: vi.fn().mockResolvedValue([]) },
    commissionStatement: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: tx.commissionStatement.create,
      update: tx.commissionStatement.update,
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
}

/** Прогоняет расчёт ведомости и возвращает строки, ушедшие в createMany. */
async function calcItems(db: ReturnType<typeof makeDb>, partnerId: string) {
  const res = await calculateStatementForPartner(db as never, {
    partnerId,
    periodFrom: PERIOD_FROM,
    periodTo: PERIOD_TO,
    calculatedByUserId: null,
  });
  expect(res.ok).toBe(true);
  const call = db._tx.commissionStatementItem.createMany.mock.calls[0]?.[0] as
    { data: CreatedItem[] } | undefined;
  return call?.data ?? [];
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.REDIS_URL;
});

// ── Инвариант 1 ────────────────────────────────────────────────────────────────

describe('§9.2 (разворот 2026-06-26): база = полная сумма платежа, НДС НЕ вычитается', () => {
  it('строка ведомости берёт полную сумму платежа; vatAmount хранится справочно и на базу не влияет', async () => {
    // Платёж 120 000 ₽, из них НДС 20 000 ₽ (vatAmount присутствует в строке —
    // разворот «вычесть НДС» немедленно дал бы базу 100 000 и комиссию 10 000).
    const db = makeDb({
      payments: [
        {
          id: 'pay-vat',
          amount: D('120000'),
          vatAmount: D('20000'),
          paidAt: PAID_BEFORE_CHANGE,
          isRefund: false,
          orderId: 'o1',
          organizationId: 'org1',
          order: { orderNumber: 'N1', partnerId: 'p1' },
          organization: { name: 'Org A', partnerId: 'p1', partnerCommissionRate: null },
        },
      ],
    });

    const items = await calcItems(db, 'p1');
    expect(items).toHaveLength(1);
    // База = полная сумма, с НДС.
    expect(items[0].baseAmount.toFixed(2)).toBe('120000.00');
    // Комиссия = полная сумма × ставка (0.10), а не (сумма − НДС) × ставка.
    expect(items[0].commissionAmount.toFixed(2)).toBe('12000.00');
  });
});

// ── Инвариант 2 ────────────────────────────────────────────────────────────────

describe('§9.1 (разворот 2026-06-26): приоритет резолвинга ставки — override организации → историческая ставка партнёра на дату платежа → дефолтная ставка партнёра', () => {
  it('приоритет 1: заданный override организации побеждает историческую ставку и дефолт', () => {
    const rate = resolveEffectiveRate({
      orgOverride: D('0.07'),
      changes: PARTNER_CHANGES, // на paidAt действует 0.20 — override всё равно выше
      paidAt: PAID_AFTER_CHANGE,
      partnerDefault: PARTNER_DEFAULT,
    });
    expect(rate.toNumber()).toBe(0.07);
  });

  it('приоритет 1: override = 0 — тоже «задано → применяем», а не провал на уровень партнёра', () => {
    const rate = resolveEffectiveRate({
      orgOverride: D(0),
      changes: PARTNER_CHANGES,
      paidAt: PAID_AFTER_CHANGE,
      partnerDefault: PARTNER_DEFAULT,
    });
    expect(rate.toNumber()).toBe(0);
  });

  it('приоритет 2: без override берётся ставка партнёра, действовавшая НА ДАТУ платежа (после смены — новая)', () => {
    const rate = resolveEffectiveRate({
      orgOverride: null,
      changes: PARTNER_CHANGES,
      paidAt: PAID_AFTER_CHANGE, // 04-20, после смены 04-15
      partnerDefault: PARTNER_DEFAULT,
    });
    expect(rate.toNumber()).toBe(0.2);
  });

  it('приоритет 2: платёж ДО даты смены получает прежнюю ставку — «новая ставка применяется с указанной даты»', () => {
    const rate = resolveEffectiveRate({
      orgOverride: null,
      changes: PARTNER_CHANGES,
      paidAt: PAID_BEFORE_CHANGE, // 04-10, до смены 04-15
      partnerDefault: PARTNER_DEFAULT,
    });
    expect(rate.toNumber()).toBe(0.1);
    // То же напрямую через таймлайн-резолвер (историческая ставка = f(paidAt)).
    expect(resolveRateAt(PARTNER_CHANGES, PAID_BEFORE_CHANGE, PARTNER_DEFAULT).toNumber()).toBe(
      0.1
    );
    expect(resolveRateAt(PARTNER_CHANGES, PAID_AFTER_CHANGE, PARTNER_DEFAULT).toNumber()).toBe(0.2);
  });

  it('приоритет 3: без override и без истории — дефолтная ставка партнёра', () => {
    const rate = resolveEffectiveRate({
      orgOverride: null,
      changes: [],
      paidAt: PAID_AFTER_CHANGE,
      partnerDefault: D('0.12'),
    });
    expect(rate.toNumber()).toBe(0.12);
  });
});

// ── Инвариант 3 ────────────────────────────────────────────────────────────────

describe('§9.1: cross-partner gate — индивидуальная ставка по чужой организации не протекает на другого партнёра', () => {
  it('платёж, отнесённый партнёру X через order.partnerId, НЕ получает скидку организации партнёра Y', async () => {
    // Организация принадлежит партнёру Y и имеет договорную скидку 0.01 (плюс
    // историю org-override — обе двери должны быть закрыты гейтом). Платёж
    // отнесён ведомости партнёра X через order.partnerId. Ставка обязана
    // резолвиться по уровню партнёра X (дефолт 0.10), а не 0.01.
    const db = makeDb({
      payments: [
        {
          id: 'pay-foreign-org',
          amount: D('100000'),
          paidAt: PAID_BEFORE_CHANGE,
          isRefund: false,
          orderId: 'o1',
          organizationId: 'orgY',
          order: { orderNumber: 'N1', partnerId: 'pX' },
          organization: {
            name: 'Org партнёра Y',
            partnerId: 'pY',
            partnerCommissionRate: D('0.01'),
          },
        },
      ],
      orgRateChanges: [
        {
          organizationId: 'orgY',
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
          oldRate: null,
          newRate: D('0.01'),
        },
      ],
    });

    const items = await calcItems(db, 'pX');
    expect(items).toHaveLength(1);
    expect(items[0].rate.toNumber()).toBe(0.1); // дефолт партнёра X
    expect(items[0].commissionAmount.toFixed(2)).toBe('10000.00'); // не 1000.00
  });

  it('контроль: та же скидка ПРИМЕНЯЕТСЯ, когда организация принадлежит самому партнёру ведомости', async () => {
    const db = makeDb({
      payments: [
        {
          id: 'pay-own-org',
          amount: D('100000'),
          paidAt: PAID_BEFORE_CHANGE,
          isRefund: false,
          orderId: 'o1',
          organizationId: 'orgX',
          order: { orderNumber: 'N1', partnerId: 'pX' },
          organization: {
            name: 'Org партнёра X',
            partnerId: 'pX',
            partnerCommissionRate: D('0.01'),
          },
        },
      ],
    });

    const items = await calcItems(db, 'pX');
    expect(items).toHaveLength(1);
    expect(items[0].rate.toNumber()).toBe(0.01);
    expect(items[0].commissionAmount.toFixed(2)).toBe('1000.00');
  });
});
