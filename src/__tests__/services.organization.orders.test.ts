import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgOrders, getOrgOrder } from '@/lib/services/organization/orders';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;
let managerId: string;
let orderA1Id: string;
let orderA2Id: string;
let orderB1Id: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `OrgOrdersP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `OrgOrdersC-${stamp}` } });
  companyId = company.id;

  const orgA = await prisma.organization.create({
    data: { name: `OrgOrdersA-${stamp}`, partnerId, companyId }
  });
  const orgB = await prisma.organization.create({
    data: { name: `OrgOrdersB-${stamp}`, partnerId, companyId }
  });
  orgAId = orgA.id;
  orgBId = orgB.id;

  const manager = await prisma.user.create({
    data: {
      email: `org-orders-mgr-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Alice Manager',
      role: 'manager'
    }
  });
  managerId = manager.id;

  const a1 = await prisma.order.create({
    data: {
      title: 'A1: Курс по охране труда',
      orderNumber: `A1-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      managerId,
      totalAmount: 100000,
      paidAmount: 25000,
      executionStatus: 'in_progress',
      financialStatus: 'partially_paid',
      productMix: ['training']
    }
  });
  orderA1Id = a1.id;

  const a2 = await prisma.order.create({
    data: {
      title: 'A2: Аттестация электробезопасности',
      orderNumber: `A2-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgAId,
      totalAmount: 50000,
      paidAmount: 50000,
      executionStatus: 'completed',
      financialStatus: 'paid'
    }
  });
  orderA2Id = a2.id;

  const b1 = await prisma.order.create({
    data: {
      title: 'B1: Заказ соседней организации',
      orderNumber: `B1-${stamp}`,
      companyId,
      partnerId,
      organizationId: orgBId,
      totalAmount: 200000,
      paidAmount: 0,
      executionStatus: 'pending',
      financialStatus: 'billed'
    }
  });
  orderB1Id = b1.id;

  // Note: with Order.organizationId NOT NULL since migration
  // 20260526132950_order_organization_id_required, legacy "orphan" rows can't be
  // created. The defensive runtime check stays in canSeeOrder/policy as belt-and-suspenders.

  await prisma.document.create({
    data: {
      name: 'contract.pdf',
      path: 'fake://contract',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderA1Id,
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  await prisma.document.create({
    data: {
      name: 'infected.pdf',
      path: 'fake://infected',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderA1Id,
      scanStatus: 'infected',
      counterpartyType: 'organization',
      counterpartyId: orgAId
    }
  });
  await prisma.payment.create({
    data: { organizationId: orgAId, orderId: orderA1Id, amount: 25000, paidAt: new Date(), method: 'bank' }
  });
  await prisma.comment.create({
    data: { orderId: orderA1Id, body: 'first comment', authorId: managerId }
  });
  await prisma.comment.create({
    data: { orderId: orderA1Id, body: 'second comment', authorId: managerId }
  });
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { author: { id: managerId } } });
  await prisma.payment.deleteMany({ where: { order: { partnerId } } });
  await prisma.document.deleteMany({ where: { order: { partnerId } } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/organization/orders — listOrgOrders', () => {
  it('returns only orders of the given organization', async () => {
    const { rows, total } = await listOrgOrders(prisma, { organizationId: orgAId });
    expect(total).toBe(2);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([orderA1Id, orderA2Id].sort());
  });

  it('does not leak orders from another organization', async () => {
    const { rows, total } = await listOrgOrders(prisma, { organizationId: orgBId });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(orderB1Id);
  });

  it('filters by executionStatus', async () => {
    const { rows, total } = await listOrgOrders(prisma, {
      organizationId: orgAId,
      executionStatus: 'completed'
    });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(orderA2Id);
  });

  it('filters by financialStatus', async () => {
    const { rows, total } = await listOrgOrders(prisma, {
      organizationId: orgAId,
      financialStatus: 'partially_paid'
    });
    expect(total).toBe(1);
    expect(rows[0]!.id).toBe(orderA1Id);
  });

  it('searches by orderNumber (case-insensitive)', async () => {
    const { rows } = await listOrgOrders(prisma, {
      organizationId: orgAId,
      search: 'a1-'
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(orderA1Id);
  });

  it('searches by title (case-insensitive)', async () => {
    const { rows } = await listOrgOrders(prisma, {
      organizationId: orgAId,
      search: 'ОХРАНЕ'
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe(orderA1Id);
  });

  it('maps fields: debt, stage, managerName', async () => {
    const { rows } = await listOrgOrders(prisma, {
      organizationId: orgAId,
      executionStatus: 'in_progress'
    });
    const a1 = rows.find((r) => r.id === orderA1Id);
    expect(a1).toBeDefined();
    expect(a1!.debt).toBe('75000.00');
    expect(a1!.totalAmount).toBe('100000.00');
    expect(a1!.paidAmount).toBe('25000.00');
    expect(a1!.managerName).toBe('Alice Manager');
    expect(a1!.stage.label).toContain('частично');
  });

  it('clamps oversized take to MAX_TAKE', async () => {
    const { rows } = await listOrgOrders(prisma, { organizationId: orgAId, take: 9999 });
    expect(rows.length).toBeLessThanOrEqual(100);
  });

  it('applies skip for pagination', async () => {
    const first = await listOrgOrders(prisma, { organizationId: orgAId, take: 1, skip: 0 });
    const second = await listOrgOrders(prisma, { organizationId: orgAId, take: 1, skip: 1 });
    expect(first.rows.length).toBe(1);
    expect(second.rows.length).toBe(1);
    expect(first.rows[0]!.id).not.toBe(second.rows[0]!.id);
  });
});

describe('services/organization/orders — getOrgOrder', () => {
  it('returns own order with documents (excluding infected) and payments', async () => {
    const detail = await getOrgOrder(prisma, orgAId, orderA1Id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(orderA1Id);
    expect(detail!.organizationId).toBe(orgAId);
    expect(detail!.documents.map((d) => d.name)).toEqual(['contract.pdf']);
    expect(detail!.payments.length).toBe(1);
    expect(detail!.payments[0]!.amount).toBe('25000.00');
    expect(detail!.commentsCount).toBe(2);
    expect(detail!.debt).toBe('75000.00');
    expect(detail!.managerName).toBe('Alice Manager');
  });

  it('returns null for foreign-org order (silent 404)', async () => {
    const detail = await getOrgOrder(prisma, orgAId, orderB1Id);
    expect(detail).toBeNull();
  });

  it('returns null for non-existent order id', async () => {
    const detail = await getOrgOrder(prisma, orgAId, 'cuid-that-does-not-exist');
    expect(detail).toBeNull();
  });
});
