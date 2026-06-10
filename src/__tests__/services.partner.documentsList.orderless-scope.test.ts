/**
 * Integration test: scoped partner sub-user (assignedOrgIds) must see
 * order-less (general) documents that belong to their partner even though
 * those docs have no orderId — the org-scope filter must NOT apply for the
 * orderLess tab.
 *
 * Requires a live Postgres instance. Auto-excluded from the unit pre-commit
 * run via mode-partitioning (contains `new PrismaClient(`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listPartnerDocuments } from '@/lib/services/partner/documentsList';

const prisma = new PrismaClient();

// Stable fixture ids — unlikely to clash with other integration tests
const COMPANY_ID = 'test-plods-co-1';
const ORG_ID = 'test-plods-org-1';
const PARTNER_ID = 'test-plods-partner-1';
const USER_ID = 'test-plods-user-1';
const DOC_ID = 'test-plods-doc-1';

async function cleanup() {
  await prisma.document.deleteMany({ where: { id: DOC_ID } });
  await prisma.partnerUser.deleteMany({ where: { userId: USER_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.partner.deleteMany({ where: { id: PARTNER_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.company.deleteMany({ where: { id: COMPANY_ID } });
}

beforeAll(async () => {
  await cleanup();

  await prisma.company.create({
    data: { id: COMPANY_ID, name: 'Test Co PLODS' }
  });
  await prisma.organization.create({
    data: { id: ORG_ID, name: 'Test Org PLODS', inn: '0000000099', companyId: COMPANY_ID }
  });
  await prisma.partner.create({
    data: { id: PARTNER_ID, name: 'Test Partner PLODS' }
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      email: 'test-plods-sub@example.com',
      name: 'Test Sub PLODS',
      passwordHash: 'x',
      role: 'partner',
      companyId: COMPANY_ID
    }
  });
  // A partner-channel order-less document: no orderId, companyId set
  await prisma.document.create({
    data: {
      id: DOC_ID,
      name: 'general-doc-plods.pdf',
      type: 'other',
      direction: 'outgoing',
      mimeType: 'application/pdf',
      size: 100,
      path: 'counterparty/partner/test-plods-partner-1/general-doc-plods.pdf',
      scanStatus: 'pending',
      generatedBy: 'user',
      counterpartyType: 'partner',
      counterpartyId: PARTNER_ID,
      companyId: COMPANY_ID,
      orderId: null,
      uploadedById: USER_ID
    }
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('listPartnerDocuments — orderLess tab with scoped sub-user', () => {
  it('includes order-less docs for the partner even when scopeOrgIds is set', async () => {
    const result = await listPartnerDocuments(prisma, {
      partnerId: PARTNER_ID,
      orderLess: true,
      scopeOrgIds: [ORG_ID], // scoped sub-user sees only this org's orders
      take: 20,
      skip: 0
    });

    const docIds = result.rows.map((r) => r.id);
    expect(docIds).toContain(DOC_ID);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('still returns zero order-bound docs for the general tab when none exist', async () => {
    // order-bound tab for the same partner — should NOT include the order-less doc
    const result = await listPartnerDocuments(prisma, {
      partnerId: PARTNER_ID,
      orderLess: false,
      scopeOrgIds: [ORG_ID],
      take: 20,
      skip: 0
    });
    expect(result.rows.map((r) => r.id)).not.toContain(DOC_ID);
  });
});
