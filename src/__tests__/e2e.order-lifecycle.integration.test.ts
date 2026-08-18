import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { claimOrder, assignOrderManager } from '@/lib/services/manager/distribution';
import { setOrderAccountingSigned } from '@/lib/services/manager/orderLifecycle';
import { transitionOrderStatus, getOrderedStatuses } from '@/lib/services/orderStatuses';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * E2E — полный жизненный цикл заявки (Order.status lifecycle), сквозной прогон
 * через РЕАЛЬНЫЕ сервисы (distribution.claimOrder / assignOrderManager,
 * orderLifecycle.transitionOrderLifecycle / setOrderAccountingSigned) против
 * живого Postgres.
 *
 * Один тенант (компания C, две живые User-записи менеджеров A и B). Компания
 * работает в C8 company-wide режиме (managerTeamVisibility=true) — так canSeeOrder
 * пропускает менеджера к любой заявке своей компании, и тест фокусируется на
 * lifecycle-инвариантах, а не на scope-проводке (её покрывают c3/f3).
 *
 * serviceType='document_development' выбран намеренно: условия завершения
 * сводятся к documents_uploaded + accounting_signed (учебная ветка
 * certificates_issued не активируется), поэтому фикстуры не тянут
 * Student/TrainingDirection/OrderItem.
 *
 * Money (Order.totalAmount) конструируется через new Prisma.Decimal и сравнивается
 * через .toFixed(2) — никакого JS-number равенства на деньгах. STAMP используется
 * ТОЛЬКО для уникальности имён/email фикстур; ассерты — на детерминированных
 * id/status/reason.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string;
let organizationId: string;
let managerAId: string; // acting manager (self-assign, transitions)
let managerBId: string; // rival manager (pre-assigned order for rejection case)
let orderId: string; // the order under lifecycle test
let assignedOrderId: string; // order pre-assigned to manager B (self-assign rejection)

const ORDER_AMOUNT = new Prisma.Decimal('150000.00');

function managerSession(sub: string): SessionPayload {
  // No managedOrgIds needed: managerTeamVisibility=true → company-wide canSeeOrder.
  return {
    sub,
    role: 'manager',
    companyId,
    managedOrgIds: [],
  } as unknown as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({
    data: { name: `e2eLifecycleCo-${STAMP}`, managerTeamVisibility: true },
  });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: { name: `e2eLifecycleOrg-${STAMP}`, companyId },
  });
  organizationId = org.id;

  // Two real manager Users — AuditLog.userId is a FK to User, and
  // assignOrderManager validates the candidate is an active manager User.
  const managerA = await prisma.user.create({
    data: {
      email: `e2e-mgrA-${STAMP}@example.test`,
      name: `E2E Manager A ${STAMP}`,
      role: 'manager',
      companyId,
    },
  });
  managerAId = managerA.id;

  const managerB = await prisma.user.create({
    data: {
      email: `e2e-mgrB-${STAMP}@example.test`,
      name: `E2E Manager B ${STAMP}`,
      role: 'manager',
      companyId,
    },
  });
  managerBId = managerB.id;

  // (1) The order under test — starts at default status 'new', unassigned,
  // non-training so completion = documents_uploaded + accounting_signed.
  const order = await prisma.order.create({
    data: {
      title: 'E2E lifecycle order',
      companyId,
      organizationId,
      totalAmount: ORDER_AMOUNT,
      serviceType: 'document_development',
    },
  });
  orderId = order.id;

  // A second order already claimed by manager B → self-assign by A must be rejected.
  const assignedOrder = await prisma.order.create({
    data: {
      title: 'E2E pre-assigned order',
      companyId,
      organizationId,
      totalAmount: new Prisma.Decimal('90000.00'),
      serviceType: 'document_development',
      managerId: managerBId,
    },
  });
  assignedOrderId = assignedOrder.id;
});

afterAll(async () => {
  const orderIds = [orderId, assignedOrderId];
  const userIds = [managerAId, managerBId];
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.document.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('E2E order lifecycle — full path through real services', () => {
  it('(1) the order was created new/unassigned with the expected money amount', async () => {
    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        statusDefinition: { select: { key: true } },
        managerId: true,
        totalAmount: true,
      },
    });
    // PR-4: старого поля больше нет — заявка стартует «Черновиком» справочника
    // (фикстура создаёт её напрямую, поэтому статус может быть пустым).
    expect([undefined, 'draft']).toContain(row?.statusDefinition?.key);
    expect(row?.managerId).toBeNull();
    // Decimal compared as fixed-point string, never JS number equality.
    expect(row?.totalAmount.toFixed(2)).toBe('150000.00');
  });

  it('(2a) manager A self-assigns the unassigned order (claimOrder)', async () => {
    const r = await claimOrder(prisma, managerSession(managerAId), { orderId });
    expect(r).toEqual({ ok: true, changed: true });

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { managerId: true },
    });
    expect(row?.managerId).toBe(managerAId);

    // self_assign wrote an audit row.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'order', entityId: orderId, action: 'order_self_assigned' },
      select: { userId: true },
    });
    expect(audit?.userId).toBe(managerAId);
  });

  it('(2b) self-assign is REJECTED for an order already assigned to a different manager', async () => {
    const r = await claimOrder(prisma, managerSession(managerAId), { orderId: assignedOrderId });
    expect(r).toEqual({ ok: false, error: 'already_assigned' });

    // Ownership unchanged — the rejected claim did not mutate managerId.
    const row = await prisma.order.findUnique({
      where: { id: assignedOrderId },
      select: { managerId: true },
    });
    expect(row?.managerId).toBe(managerBId);
  });

  it('(2c) a leader can explicitly (re)assign the order to manager A (assignOrderManager, positive control)', async () => {
    // Idempotent — A already owns it — so changed:false and no error.
    const r = await assignOrderManager(prisma, managerSession(managerAId), {
      orderId,
      managerUserId: managerAId,
      restrictToCompanyId: companyId,
    });
    expect(r).toEqual({ ok: true, changed: false });
  });

  // §10 ТЗ v0.5 (этап 2, PR-4): рабочий статус живёт в справочнике; шаги
  // «ждём клиента» больше нет — §10 такого статуса не знает, причина возврата
  // хранится отдельным полем и проверяется своими тестами.
  async function statusId(key: string): Promise<string> {
    const all = await getOrderedStatuses(prisma);
    const row = all.find((s) => s.key === key);
    if (!row) throw new Error(`нет статуса ${key}`);
    return row.id;
  }

  it('(3a) черновик → принято в работу', async () => {
    const r = await transitionOrderStatus(prisma, managerSession(managerAId), {
      orderId,
      toId: await statusId('accepted'),
    });
    expect(r.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(row?.statusDefinition?.key).toBe('accepted');
  });

  it('(4) completion is BLOCKED while completion conditions are unmet (completion_conditions_unmet)', async () => {
    // No clean document, accounting not signed → both conditions unmet.
    const r = await transitionOrderStatus(prisma, managerSession(managerAId), {
      orderId,
      toId: await statusId('closed'),
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toBe('completion_conditions_unmet');
    if (r.error !== 'completion_conditions_unmet') throw new Error('unreachable');
    // document_development → certificates_issued NOT among unmet conditions.
    expect(r.unmet.sort()).toEqual(['accounting_signed', 'documents_uploaded'].sort());

    // Статус не сдвинулся.
    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(row?.statusDefinition?.key).toBe('accepted');
  });

  it('(5a) satisfy documents_uploaded — a clean scanned document on the order', async () => {
    await prisma.document.create({
      data: {
        name: 'e2e-contract.pdf',
        path: 's3://x/e2e-contract',
        mimeType: 'application/pdf',
        type: 'contract',
        direction: 'incoming',
        orderId,
        counterpartyType: 'organization',
        counterpartyId: organizationId,
        scanStatus: 'clean',
      },
    });
  });

  it('(5b) satisfy accounting_signed via the real service (setOrderAccountingSigned)', async () => {
    const r = await setOrderAccountingSigned(prisma, managerSession(managerAId), {
      orderId,
      signed: true,
    });
    expect(r).toEqual({ ok: true, changed: true });

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { accountingSignedAt: true },
    });
    expect(row?.accountingSignedAt).not.toBeNull();
  });

  it('(5c) after every completion condition is met, completion SUCCEEDS', async () => {
    const r = await transitionOrderStatus(prisma, managerSession(managerAId), {
      orderId,
      toId: await statusId('closed'),
    });
    expect(r.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { statusDefinition: { select: { key: true } } },
    });
    expect(row?.statusDefinition?.key).toBe('closed');
  });

  it('(6) возврат из «закрыта» доступен руководителю и пишется в журнал', async () => {
    // §10 ТЗ v0.5: возврат на предыдущую стадию — право администратора и
    // руководителя; обычному менеджеру он теперь запрещён (проверяется ниже).
    const mgr = await transitionOrderStatus(prisma, managerSession(managerAId), {
      orderId,
      toId: await statusId('accepted'),
    });
    expect(mgr).toEqual({ ok: false, error: 'backward_forbidden' });

    // тот же пользователь, но в роли руководителя (ТЗ 2026-08-17: руководитель —
    // самостоятельная top-level роль) — проверяем именно право, а не человека
    const leaderSession = { ...managerSession(managerAId), role: 'leader' as const };
    const r = await transitionOrderStatus(prisma, leaderSession, {
      orderId,
      toId: await statusId('accepted'),
    });
    expect(r.ok).toBe(true);

    const changes = await prisma.orderStatusChange.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      take: 1,
      select: { userId: true, from: { select: { key: true } }, to: { select: { key: true } } },
    });
    expect(changes[0]?.userId).toBe(managerAId);
    expect(changes[0]?.from?.key).toBe('closed');
    expect(changes[0]?.to?.key).toBe('accepted');
  });
});
