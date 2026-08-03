/**
 * Инвариант-тест домена «комиссия» №4 — «исполняемое ТЗ» (фаза 6),
 * integration-слой (живой Postgres через `new PrismaClient()`).
 *
 * Откуда инвариант: ТЗ [docs/tz/2026-07-29-tz-lk-otsfera-v0.5.md] §9.2 —
 * «Каждая строка расчёта = один платёж», платёж относится к месяцу по paidAt.
 * Отсюда: один paidAt = один факт выплаты. Повторный расчёт/генерация за тот же
 * период НЕ создаёт вторую выплату по тому же платежу.
 *
 * Фактическая модель идемпотентности (statement.ts C-01 + миграция
 * 20260614000000_commission_statement_partial_unique + scripts/
 * dedupe-commission-statements.ts): на (partnerId, periodFrom, periodTo)
 * существует не более ОДНОЙ живой (supersededBy IS NULL) ведомости.
 * Повторный расчёт draft-периода переписывает строки in-place (isNew=false);
 * пересчёт после approve создаёт новую ведомость и помечает старую
 * supersededBy — платёж в любой момент времени входит ровно в одну живую
 * строку выплаты. Этот файл закрепляет обе ветки.
 *
 * Фикстурный паттерн переиспользован из e2e.commission-lifecycle.integration.test.ts
 * (STAMP — только для уникальных имён; все проверяемые числа/даты детерминированы).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { calculateStatementForPartner } from '@/lib/services/commission/statement';
import { approveStatement } from '@/lib/services/commission/lifecycle';

let prisma: PrismaClient;
const STAMP = Date.now();

const PERIOD_FROM = new Date('2026-06-01T00:00:00.000Z');
const PERIOD_TO = new Date('2026-06-30T23:59:59.999Z');
const PAID_AT = new Date('2026-06-10T00:00:00.000Z');
const AMOUNT = new Prisma.Decimal('100000');
const RATE = new Prisma.Decimal('0.1');

let partnerId: string;
let partnerUserId: string;
let companyId: string;
let orgId: string;
let paymentId: string;

/** Живые (supersededBy IS NULL) ведомости партнёра за период. */
function liveStatements() {
  return prisma.commissionStatement.findMany({
    where: {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      supersededBy: null,
    },
    select: { id: true, status: true, totalCommissionAmount: true },
  });
}

/** Сколько раз платёж входит строкой в живые ведомости = сколько раз он «выплачивается». */
function livePayoutLinesForPayment() {
  return prisma.commissionStatementItem.count({
    where: { paymentId, statement: { supersededBy: null } },
  });
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const partner = await prisma.partner.create({
    data: { name: `invComm-P-${STAMP}`, commissionRate: RATE },
  });
  partnerId = partner.id;

  const company = await prisma.company.create({ data: { name: `invComm-C-${STAMP}` } });
  companyId = company.id;

  const partnerUser = await prisma.user.create({
    data: {
      email: `invComm-partner-${STAMP}@x.local`,
      passwordHash: 'h',
      name: 'Partner Admin',
      role: 'partner',
      partnerId,
    },
  });
  partnerUserId = partnerUser.id;

  const org = await prisma.organization.create({
    data: { name: `invComm-Org-${STAMP}`, partnerId, companyId },
  });
  orgId = org.id;

  const order = await prisma.order.create({
    data: {
      title: `invComm-order-${STAMP}`,
      companyId,
      organizationId: orgId,
      partnerId,
      totalAmount: AMOUNT,
      financialStatus: 'paid',
    },
  });
  const payment = await prisma.payment.create({
    data: { organizationId: orgId, orderId: order.id, amount: AMOUNT, paidAt: PAID_AT },
  });
  paymentId = payment.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: partnerUserId } });
  await prisma.commissionStatementItem.deleteMany({ where: { statement: { partnerId } } });
  await prisma.commissionStatement.deleteMany({ where: { partnerId } });
  await prisma.payment.deleteMany({ where: { organizationId: orgId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.user.deleteMany({ where: { id: partnerUserId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('§9.2: один paidAt = один факт выплаты — повторный расчёт за тот же период не создаёт вторую выплату по тому же платежу', () => {
  let firstStatementId: string;

  it('повторный расчёт draft-периода переиспользует ту же ведомость (in-place), а не создаёт вторую', async () => {
    const first = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: partnerUserId,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(`calc-1 failed: ${first.error}`);
    expect(first.isNew).toBe(true);
    firstStatementId = first.statement.id;

    const second = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: partnerUserId,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(`calc-2 failed: ${second.error}`);
    // Не новая ведомость — тот же draft, переписанный in-place.
    expect(second.isNew).toBe(false);
    expect(second.statement.id).toBe(firstStatementId);

    // Ровно одна живая ведомость за (партнёр, период)…
    const live = await liveStatements();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(firstStatementId);
    // …и платёж входит в живые ведомости ровно одной строкой (не задвоился).
    expect(await livePayoutLinesForPayment()).toBe(1);
    // Итог не удвоен: 100000 × 0.10 = 10000, а не 20000.
    expect(live[0].totalCommissionAmount.toFixed(2)).toBe('10000.00');
  });

  it('пересчёт после approve создаёт новую живую ведомость и гасит старую (supersede) — платёж по-прежнему выплачивается один раз', async () => {
    const approved = await approveStatement(prisma, {
      statementId: firstStatementId,
      partnerId,
      approvedByUserId: partnerUserId,
    });
    expect(approved.ok).toBe(true);

    const recalc = await calculateStatementForPartner(prisma, {
      partnerId,
      periodFrom: PERIOD_FROM,
      periodTo: PERIOD_TO,
      calculatedByUserId: partnerUserId,
    });
    expect(recalc.ok).toBe(true);
    if (!recalc.ok) throw new Error(`recalc failed: ${recalc.error}`);
    // Approved нельзя переписать — создаётся новая ведомость…
    expect(recalc.isNew).toBe(true);
    expect(recalc.statement.id).not.toBe(firstStatementId);

    // …но старая при этом ГАСИТСЯ: живой остаётся ровно одна.
    const live = await liveStatements();
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(recalc.statement.id);

    const superseded = await prisma.commissionStatement.findUniqueOrThrow({
      where: { id: firstStatementId },
      select: { supersededBy: true },
    });
    expect(superseded.supersededBy).toBe(recalc.statement.id);

    // Факт выплаты по платежу один: одна строка в живых ведомостях, итог не удвоен.
    expect(await livePayoutLinesForPayment()).toBe(1);
    expect(live[0].totalCommissionAmount.toFixed(2)).toBe('10000.00');
  });
});

// Integration-tier: vitest классифицирует по `new PrismaClient(` в beforeAll.
// REDIS_URL в тестах отсутствует → BullMQ/S3/email не задеваются, моки не нужны.
