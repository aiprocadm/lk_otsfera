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
      data: { organizationId: orgAId, orderId: order.id, amount: 1000, paidAt: new Date() }
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
      data: { organizationId: orgBId, orderId: otherOrder.id, amount: 9000, paidAt: new Date() }
    });

    const evts = await recentEvents(prisma, orgAId, 50);
    expect(evts.length).toBeGreaterThan(0);
    // Must include the orgA event we just created
    expect(evts.some((e) => e.orderId === order.id)).toBe(true);
    // Must NOT include any orgB event
    expect(evts.some((e) => e.orderId === otherOrder.id)).toBe(false);
  });
});

describe('organization dashboard service — channel-isolation leak regression', () => {
  // The critical invariant: a partner-channel document on the org's OWN order
  // must NOT appear in org dashboard kpis or recentEvents. An unscoped
  // `order: { organizationId }` query would include it; the channel filter must not.
  it('partner-channel doc on org order is excluded from kpis.recentDocumentsCount', async () => {
    const order = await prisma.order.create({
      data: {
        title: 'leak-test-order', companyId, partnerId, organizationId: orgAId,
        executionStatus: 'in_progress'
      }
    });
    // Partner-channel document — on the org's own order, counterparty = partner
    await prisma.document.create({
      data: {
        name: 'commission_statement.pdf',
        path: 'fake://partner-channel-doc',
        mimeType: 'application/pdf',
        orderId: order.id,
        counterpartyType: 'partner',
        counterpartyId: partnerId
      }
    });
    // Org-channel document — should be counted
    await prisma.document.create({
      data: {
        name: 'org_channel_doc.pdf',
        path: 'fake://org-channel-doc',
        mimeType: 'application/pdf',
        orderId: order.id,
        counterpartyType: 'organization',
        counterpartyId: orgAId
      }
    });

    // Sanity: the partner doc IS on this order — an unscoped query would see it
    const partnerChannelCount = await prisma.document.count({
      where: { orderId: order.id, counterpartyType: 'partner', counterpartyId: partnerId, scanStatus: { not: 'infected' } }
    });
    expect(partnerChannelCount).toBeGreaterThanOrEqual(1);

    // Capture kpis WITH the partner-channel doc present
    const kWithPartner = await kpis(prisma, orgAId);
    const countWithPartner = kWithPartner.recentDocumentsCount;

    // Delete the partner-channel doc and re-count — result must be the same
    // (proves the partner doc was never counted in the org dashboard)
    await prisma.document.deleteMany({
      where: { orderId: order.id, counterpartyType: 'partner', counterpartyId: partnerId }
    });
    const kWithoutPartner = await kpis(prisma, orgAId);
    expect(kWithoutPartner.recentDocumentsCount).toBe(countWithPartner);

    // The org-channel doc must still be counted (count > 0)
    expect(countWithPartner).toBeGreaterThanOrEqual(1);
  });

  it('partner-channel doc on org order does NOT appear in recentEvents document feed', async () => {
    const order = await prisma.order.create({
      data: {
        title: 'leak-events-order', companyId, partnerId, organizationId: orgAId,
        executionStatus: 'in_progress'
      }
    });
    // Partner-channel document — on the org's own order
    const partnerDoc = await prisma.document.create({
      data: {
        name: 'partner_reverse_upload.pdf',
        path: 'fake://partner-events-leak',
        mimeType: 'application/pdf',
        orderId: order.id,
        counterpartyType: 'partner',
        counterpartyId: partnerId
      }
    });
    // Org-channel document — must appear
    const orgDoc = await prisma.document.create({
      data: {
        name: 'org_visible_doc.pdf',
        path: 'fake://org-events-visible',
        mimeType: 'application/pdf',
        orderId: order.id,
        counterpartyType: 'organization',
        counterpartyId: orgAId
      }
    });

    const evts = await recentEvents(prisma, orgAId, 100);
    const docEventIds = evts.filter((e) => e.kind === 'document_published').map((e) => e.id);

    // The org-channel doc MUST appear in the feed
    expect(docEventIds.some((id) => id === `doc-${orgDoc.id}`)).toBe(true);
    // The partner-channel doc must NOT appear — even though it is on the same order
    expect(docEventIds.some((id) => id === `doc-${partnerDoc.id}`)).toBe(false);
  });
});
