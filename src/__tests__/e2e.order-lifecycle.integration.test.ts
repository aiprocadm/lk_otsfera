import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { claimOrder, assignOrderManager } from '@/lib/services/manager/distribution';
import { transitionOrderLifecycle, setOrderAccountingSigned } from '@/lib/services/manager/orderLifecycle';
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
    managedOrgIds: []
  } as unknown as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({
    data: { name: `e2eLifecycleCo-${STAMP}`, managerTeamVisibility: true }
  });
  companyId = company.id;

  const org = await prisma.organization.create({
    data: { name: `e2eLifecycleOrg-${STAMP}`, companyId }
  });
  organizationId = org.id;

  // Two real manager Users — AuditLog.userId is a FK to User, and
  // assignOrderManager validates the candidate is an active manager User.
  const managerA = await prisma.user.create({
    data: {
      email: `e2e-mgrA-${STAMP}@example.test`,
      name: `E2E Manager A ${STAMP}`,
      role: 'manager',
      companyId
    }
  });
  managerAId = managerA.id;

  const managerB = await prisma.user.create({
    data: {
      email: `e2e-mgrB-${STAMP}@example.test`,
      name: `E2E Manager B ${STAMP}`,
      role: 'manager',
      companyId
    }
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
      serviceType: 'document_development'
    }
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
      managerId: managerBId
    }
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
      select: { status: true, managerId: true, totalAmount: true }
    });
    expect(row?.status).toBe('new');
    expect(row?.managerId).toBeNull();
    // Decimal compared as fixed-point string, never JS number equality.
    expect(row?.totalAmount.toFixed(2)).toBe('150000.00');
  });

  it('(2a) manager A self-assigns the unassigned order (claimOrder)', async () => {
    const r = await claimOrder(prisma, managerSession(managerAId), { orderId });
    expect(r).toEqual({ ok: true, changed: true });

    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { managerId: true } });
    expect(row?.managerId).toBe(managerAId);

    // self_assign wrote an audit row.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'order', entityId: orderId, action: 'order_self_assigned' },
      select: { userId: true }
    });
    expect(audit?.userId).toBe(managerAId);
  });

  it('(2b) self-assign is REJECTED for an order already assigned to a different manager', async () => {
    const r = await claimOrder(prisma, managerSession(managerAId), { orderId: assignedOrderId });
    expect(r).toEqual({ ok: false, error: 'already_assigned' });

    // Ownership unchanged — the rejected claim did not mutate managerId.
    const row = await prisma.order.findUnique({
      where: { id: assignedOrderId },
      select: { managerId: true }
    });
    expect(row?.managerId).toBe(managerBId);
  });

  it('(2c) a leader can explicitly (re)assign the order to manager A (assignOrderManager, positive control)', async () => {
    // Idempotent — A already owns it — so changed:false and no error.
    const r = await assignOrderManager(prisma, managerSession(managerAId), {
      orderId,
      managerUserId: managerAId,
      restrictToCompanyId: companyId
    });
    expect(r).toEqual({ ok: true, changed: false });
  });

  it('(3a) new → in_progress advances the lifecycle', async () => {
    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'in_progress'
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'in_progress' });
  });

  it('(3b) in_progress → waiting_client stores the return reason (trimmed) and persists it', async () => {
    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'waiting_client',
      reason: '  Клиент не прислал реквизиты  '
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'waiting_client' });

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, returnReason: true }
    });
    expect(row?.status).toBe('waiting_client');
    expect(row?.returnReason).toBe('Клиент не прислал реквизиты');

    // The audit row for this transition carries the reason in its meta.
    const audit = await prisma.auditLog.findFirst({
      where: { entity: 'order', entityId: orderId, action: 'order_lifecycle_changed' },
      orderBy: { createdAt: 'desc' },
      select: { meta: true }
    });
    const meta = audit?.meta as { reason?: string; after?: { status?: string } } | null;
    expect(meta?.reason).toBe('Клиент не прислал реквизиты');
    expect(meta?.after?.status).toBe('waiting_client');
  });

  it('(3c) waiting_client → in_progress clears the return reason', async () => {
    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'in_progress'
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'in_progress' });

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, returnReason: true }
    });
    expect(row?.status).toBe('in_progress');
    expect(row?.returnReason).toBeNull();
  });

  it('(4) completion is BLOCKED while completion conditions are unmet (completion_conditions_unmet)', async () => {
    // No clean document, accounting not signed → both conditions unmet.
    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'completed'
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.error).toBe('completion_conditions_unmet');
    if (r.error !== 'completion_conditions_unmet') throw new Error('unreachable');
    // document_development → certificates_issued NOT among unmet conditions.
    expect(r.unmet.sort()).toEqual(['accounting_signed', 'documents_uploaded'].sort());

    // Status did not move.
    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    expect(row?.status).toBe('in_progress');
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
        scanStatus: 'clean'
      }
    });
  });

  it('(5b) satisfy accounting_signed via the real service (setOrderAccountingSigned)', async () => {
    const r = await setOrderAccountingSigned(prisma, managerSession(managerAId), {
      orderId,
      signed: true
    });
    expect(r).toEqual({ ok: true, changed: true });

    const row = await prisma.order.findUnique({
      where: { id: orderId },
      select: { accountingSignedAt: true }
    });
    expect(row?.accountingSignedAt).not.toBeNull();
  });

  it('(5c) after every completion condition is met, completion SUCCEEDS', async () => {
    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'completed'
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'completed' });

    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    expect(row?.status).toBe('completed');
  });

  it('(6) reopen completed → in_progress is allowed and writes an AuditLog row', async () => {
    const auditBefore = await prisma.auditLog.count({
      where: { entity: 'order', entityId: orderId, action: 'order_lifecycle_changed' }
    });

    const r = await transitionOrderLifecycle(prisma, managerSession(managerAId), {
      orderId,
      to: 'in_progress'
    });
    expect(r).toEqual({ ok: true, changed: true, status: 'in_progress' });

    const row = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
    expect(row?.status).toBe('in_progress');

    // A fresh lifecycle audit row was appended, capturing completed → in_progress.
    const auditAfter = await prisma.auditLog.count({
      where: { entity: 'order', entityId: orderId, action: 'order_lifecycle_changed' }
    });
    expect(auditAfter).toBe(auditBefore + 1);

    const reopen = await prisma.auditLog.findFirst({
      where: { entity: 'order', entityId: orderId, action: 'order_lifecycle_changed' },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, meta: true }
    });
    expect(reopen?.userId).toBe(managerAId);
    const meta = reopen?.meta as { before?: { status?: string }; after?: { status?: string } } | null;
    expect(meta?.before?.status).toBe('completed');
    expect(meta?.after?.status).toBe('in_progress');
  });
});
