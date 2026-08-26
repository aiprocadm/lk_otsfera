import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getOrgDocuments } from '@/lib/services/partner/orgDocuments';
import { listPartnerDocuments } from '@/lib/services/partner/documentsList';
import { getPartnerOrderDetail } from '@/lib/services/partner/orderDetail';

let prisma: PrismaClient;

let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;
let orderA1Id: string;
let orderB1Id: string;

// partner-channel docs (should be visible to the partner)
let partnerDocAct: string; // partner-channel, orderA1
let partnerDocInvoice: string; // partner-channel, orderB1

// org-channel docs (must NOT leak to the partner)
let orgChannelDoc: string; // org-channel on orderA1 — must not appear

// infected partner-channel doc (must be hidden)
let infectedDoc: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const partner = await prisma.partner.create({
    data: { name: `PartnerDocsP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const company = await prisma.company.create({ data: { name: `PartnerDocsC-${stamp}` } });
  companyId = company.id;

  const orgA = await prisma.organization.create({
    data: { name: `PartnerDocsOrgA-${stamp}`, partnerId, companyId },
  });
  const orgB = await prisma.organization.create({
    data: { name: `PartnerDocsOrgB-${stamp}`, partnerId, companyId },
  });
  orgAId = orgA.id;
  orgBId = orgB.id;

  const orderA1 = await prisma.order.create({
    data: {
      title: 'PA1 order',
      companyId,
      partnerId,
      organizationId: orgAId,
      executionStatus: 'in_progress',
    },
  });
  const orderB1 = await prisma.order.create({
    data: {
      title: 'PB1 order',
      companyId,
      partnerId,
      organizationId: orgBId,
      executionStatus: 'pending',
    },
  });
  orderA1Id = orderA1.id;
  orderB1Id = orderB1.id;

  // F2: the partner sees a deal only via its own lead — promote orderA1 from a lead
  // so getPartnerOrderDetail(orderA1) resolves (the document-channel assertions below
  // are about doc isolation, unaffected by this linkage).
  const u = await prisma.user.create({
    data: {
      email: `pdocs-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'U',
      role: 'partner',
      partnerId,
    },
  });
  await prisma.lead.create({
    data: {
      partnerId,
      createdByUserId: u.id,
      organizationId: orgAId,
      clientCompanyName: 'c',
      clientContactName: 'n',
      subject: 's',
      status: 'promoted_to_order',
      productType: [],
      promotedOrderId: orderA1Id,
    },
  });

  // Partner-channel doc on orderA1
  const dAct = await prisma.document.create({
    data: {
      name: 'act-partner-A1.pdf',
      path: 'fake://partner-act-a1',
      mimeType: 'application/pdf',
      type: 'act',
      orderId: orderA1Id,
      counterpartyType: 'partner',
      counterpartyId: partnerId,
    },
  });
  partnerDocAct = dAct.id;

  // Partner-channel doc on orderB1
  const dInvoice = await prisma.document.create({
    data: {
      name: 'commission-partner-B1.pdf',
      path: 'fake://partner-commission-b1',
      mimeType: 'application/pdf',
      type: 'commission_statement',
      orderId: orderB1Id,
      counterpartyType: 'partner',
      counterpartyId: partnerId,
    },
  });
  partnerDocInvoice = dInvoice.id;

  // Org-channel doc on orderA1 — must NOT be visible to the partner
  const dOrgChannel = await prisma.document.create({
    data: {
      name: 'contract-org-channel-A1.pdf',
      path: 'fake://org-contract-a1',
      mimeType: 'application/pdf',
      type: 'contract',
      orderId: orderA1Id,
      counterpartyType: 'organization',
      counterpartyId: orgAId,
    },
  });
  orgChannelDoc = dOrgChannel.id;

  // Infected partner-channel doc on orderA1 — must be hidden
  const dInfected = await prisma.document.create({
    data: {
      name: 'malware-partner-A1.pdf',
      path: 'fake://infected-partner-a1',
      mimeType: 'application/pdf',
      type: 'other',
      orderId: orderA1Id,
      scanStatus: 'infected',
      scanReason: 'EICAR test',
      counterpartyType: 'partner',
      counterpartyId: partnerId,
    },
  });
  infectedDoc = dInfected.id;
});

afterAll(async () => {
  await prisma.document.deleteMany({ where: { order: { partnerId } } });
  await prisma.lead.deleteMany({ where: { partnerId } });
  await prisma.order.deleteMany({ where: { partnerId } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.user.deleteMany({ where: { partnerId } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// getOrgDocuments
// ---------------------------------------------------------------------------
describe('services/partner/orgDocuments — getOrgDocuments', () => {
  it('returns partner-channel doc for the org', async () => {
    const { rows, total } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocAct);
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('does NOT leak organization-channel docs to the partner', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(orgChannelDoc);
    expect(ids).toContain(partnerDocAct);
  });

  it('hides infected partner-channel docs', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(infectedDoc);
  });

  it('does not return docs from another org (orderB1 is orgB)', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(partnerDocInvoice);
  });

  it('returns empty when org does not belong to this partner', async () => {
    const { rows, total } = await getOrgDocuments(prisma, {
      orgId: orgAId,
      partnerId: 'non-existent-partner-id',
    });
    expect(total).toBe(0);
    expect(rows).toEqual([]);
  });

  it('filters by type', async () => {
    const { rows } = await getOrgDocuments(prisma, { orgId: orgAId, partnerId, type: 'act' });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocAct);
  });
});

// ---------------------------------------------------------------------------
// listPartnerDocuments
// ---------------------------------------------------------------------------
describe('services/partner/documentsList — listPartnerDocuments', () => {
  it('returns all partner-channel docs across all orgs', async () => {
    const { rows, total } = await listPartnerDocuments(prisma, {
      partnerId,
      take: 50,
      skip: 0,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocAct);
    expect(ids).toContain(partnerDocInvoice);
    expect(total).toBeGreaterThanOrEqual(2);
  });

  it('does NOT leak organization-channel docs to the partner', async () => {
    const { rows } = await listPartnerDocuments(prisma, {
      partnerId,
      take: 50,
      skip: 0,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(orgChannelDoc);
    expect(ids).toContain(partnerDocAct);
  });

  it('hides infected docs', async () => {
    const { rows } = await listPartnerDocuments(prisma, {
      partnerId,
      take: 50,
      skip: 0,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(infectedDoc);
  });

  it('narrows by scopeOrgIds to only orgA docs', async () => {
    const { rows } = await listPartnerDocuments(prisma, {
      partnerId,
      scopeOrgIds: [orgAId],
      take: 50,
      skip: 0,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocAct);
    expect(ids).not.toContain(partnerDocInvoice); // lives on orgB order
  });

  it('filters by type', async () => {
    const { rows } = await listPartnerDocuments(prisma, {
      partnerId,
      type: 'commission_statement',
      take: 50,
      skip: 0,
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(partnerDocInvoice);
    expect(ids).not.toContain(partnerDocAct);
  });

  it('searches by name (case-insensitive)', async () => {
    const { rows } = await listPartnerDocuments(prisma, {
      partnerId,
      search: 'ACT-PARTNER',
      take: 50,
      skip: 0,
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.id).toBe(partnerDocAct);
  });

  it('countsByType reflects only partner-channel visible docs', async () => {
    const { countsByType } = await listPartnerDocuments(prisma, {
      partnerId,
      take: 50,
      skip: 0,
    });
    expect(countsByType.act).toBeGreaterThanOrEqual(1);
    expect(countsByType.commission_statement).toBeGreaterThanOrEqual(1);
    // org-channel contract must not be counted
    expect(countsByType.contract).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPartnerOrderDetail — documents embed
// ---------------------------------------------------------------------------
describe('services/partner/dealDetail — documents embed channel isolation', () => {
  it('includes partner-channel doc in deal detail documents', async () => {
    const detail = await getPartnerOrderDetail(prisma, { orderId: orderA1Id, partnerId });
    expect(detail).not.toBeNull();
    const docIds = detail!.documents.map((d) => d.id);
    expect(docIds).toContain(partnerDocAct);
  });

  it('does NOT include organization-channel doc in deal detail documents', async () => {
    const detail = await getPartnerOrderDetail(prisma, { orderId: orderA1Id, partnerId });
    expect(detail).not.toBeNull();
    const docIds = detail!.documents.map((d) => d.id);
    expect(docIds).not.toContain(orgChannelDoc);
  });

  it('does NOT include infected partner-channel doc in deal detail documents', async () => {
    const detail = await getPartnerOrderDetail(prisma, { orderId: orderA1Id, partnerId });
    expect(detail).not.toBeNull();
    const docIds = detail!.documents.map((d) => d.id);
    expect(docIds).not.toContain(infectedDoc);
  });
});
