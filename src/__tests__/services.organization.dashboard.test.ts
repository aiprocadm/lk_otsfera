import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { kpis, attention, recentEvents } from '@/lib/services/organization/dashboard';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;
let userId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const partner = await prisma.partner.create({
    data: { name: 'OrgDashP-' + Date.now(), commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: 'OrgDashC-' + Date.now() } });
  companyId = company.id;
  const orgA = await prisma.organization.create({
    data: { name: 'OrgA-' + Date.now(), partnerId, companyId }
  });
  const orgB = await prisma.organization.create({
    data: { name: 'OrgB-' + Date.now(), partnerId, companyId }
  });
  orgAId = orgA.id;
  orgBId = orgB.id;
  const user = await prisma.user.create({
    data: {
      email: `org-dash-${Date.now()}@t.local`,
      passwordHash: 'x',
      name: 'AuthorOrg',
      role: 'admin'
    }
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.comment.deleteMany({ where: { author: { id: userId } } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.payment.deleteMany({ where: { order: { partnerId } } });
  await prisma.document.deleteMany({ where: { order: { partnerId } } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.student.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('organization dashboard service — kpis', () => {
  it('returns all zeros for empty org', async () => {
    const k = await kpis(prisma, orgBId);
    expect(k).toEqual({
      activeOrders: 0,
      outstandingAmount: '0.00',
      studentsCount: 0,
      recentDocumentsCount: 0
    });
  });

  it('counts active orders and sums outstanding (org-scoped)', async () => {
    await prisma.order.create({
      data: {
        title: 'A-open-1', companyId, partnerId, organizationId: orgAId,
        totalAmount: 100000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed'
      }
    });
    await prisma.order.create({
      data: {
        title: 'A-open-2', companyId, partnerId, organizationId: orgAId,
        totalAmount: 80000, paidAmount: 30000,
        executionStatus: 'pending', financialStatus: 'partially_paid'
      }
    });
    // foreign org order — must not affect orgA kpis
    await prisma.order.create({
      data: {
        title: 'B-open', companyId, partnerId, organizationId: orgBId,
        totalAmount: 500000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed'
      }
    });

    const k = await kpis(prisma, orgAId);
    expect(k.activeOrders).toBe(2);
    expect(k.outstandingAmount).toBe('150000.00');
  });

  it('counts students for the org', async () => {
    await prisma.student.create({
      data: { email: `s1-${Date.now()}@t.local`, name: 'S1', organizationId: orgAId }
    });
    await prisma.student.create({
      data: { email: `s2-${Date.now()}@t.local`, name: 'S2', organizationId: orgAId }
    });
    const k = await kpis(prisma, orgAId);
    expect(k.studentsCount).toBe(2);
  });

  it('counts recent (last 30 days) documents, excluding infected', async () => {
    const order = await prisma.order.create({
      data: {
        title: 'A-doc-order', companyId, partnerId, organizationId: orgAId,
        executionStatus: 'in_progress'
      }
    });
    await prisma.document.create({
      data: { name: 'd1', path: 'fake://1', mimeType: 'application/pdf', orderId: order.id, counterpartyType: 'organization', counterpartyId: orgAId }
    });
    await prisma.document.create({
      data: { name: 'd2', path: 'fake://2', mimeType: 'application/pdf', orderId: order.id, scanStatus: 'infected', counterpartyType: 'organization', counterpartyId: orgAId }
    });

    const k = await kpis(prisma, orgAId);
    expect(k.recentDocumentsCount).toBe(1);
  });
});

describe('organization dashboard service — attention', () => {
  it('returns empty for org without issues', async () => {
    const a = await attention(prisma, orgBId);
    expect(a.items).toEqual([]);
  });

  it('surfaces billed-but-unpaid orders older than 7 days', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    const o = await prisma.order.create({
      data: {
        title: 'A-billed-old', companyId, partnerId, organizationId: orgAId,
        totalAmount: 50000, paidAmount: 0,
        executionStatus: 'in_progress', financialStatus: 'billed'
      }
    });
    await prisma.order.update({ where: { id: o.id }, data: { updatedAt: eightDaysAgo } });

    const a = await attention(prisma, orgAId);
    const billed = a.items.filter((i) => i.kind === 'billed_unpaid');
    expect(billed.length).toBeGreaterThanOrEqual(1);
    expect(billed.some((i) => i.orderId === o.id)).toBe(true);
  });
});

describe('organization dashboard service — recentEvents', () => {
  it('returns events from documents/payments/comments scoped to org', async () => {
    const order = await prisma.order.create({
      data: {
        title: 'A-events-order', companyId, partnerId, organizationId: orgAId,
        executionStatus: 'in_progress'
      }
    });
    await prisma.payment.create({
      data: { orderId: order.id, amount: 1000, paidAt: new Date() }
    });
    await prisma.comment.create({
      data: { orderId: order.id, body: 'hello from org', authorId: userId }
    });
    // foreign org event — must not appear
    const otherOrder = await prisma.order.create({
      data: {
        title: 'B-events-order', companyId, partnerId, organizationId: orgBId,
        executionStatus: 'in_progress'
      }
    });
    await prisma.payment.create({
      data: { orderId: otherOrder.id, amount: 9000, paidAt: new Date() }
    });

    const evts = await recentEvents(prisma, orgAId, 50);
    expect(evts.length).toBeGreaterThan(0);
    // Must include the orgA event we just created
    expect(evts.some((e) => e.orderId === order.id)).toBe(true);
    // Must NOT include any orgB event
    expect(evts.some((e) => e.orderId === otherOrder.id)).toBe(false);
  });
});
