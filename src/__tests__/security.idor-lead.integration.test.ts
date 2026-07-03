import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getLead, listLeads, withdrawLead } from '@/lib/services/partner/leads';

/**
 * Security regression (Track E / E2-A) — Lead IDOR across partners.
 *
 * A Lead belongs to exactly one partner (`Lead.partnerId`). The partner-cabinet
 * lead services (`getLead` / `listLeads` / `withdrawLead`) must reject any access
 * to another partner's lead — by id, in lists, and in the mutating withdraw path.
 * The optional `scopeOrgIds` (partner sub-manager restricted to certain orgs) is
 * also enforced. Two partners (A, B) under one seller company; each owns one lead.
 *
 * NOTE: Leads are a single-tenant shared TEAM QUEUE on the manager side (no
 * companyId, see services/manager/leads.ts) — so the isolation dimension that
 * matters is the PARTNER one, which is what this file pins down.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let partnerA: string, partnerB: string;
let companyC: string, orgA: string, orgB: string;
let author: string;
let leadA: string, leadB: string;

beforeAll(async () => {
  prisma = new PrismaClient();

  const pA = await prisma.partner.create({ data: { name: `idorLeadPA-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') } });
  partnerA = pA.id;
  const pB = await prisma.partner.create({ data: { name: `idorLeadPB-${STAMP}`, commissionRate: new Prisma.Decimal('0.2') } });
  partnerB = pB.id;

  const c = await prisma.company.create({ data: { name: `idorLeadCo-${STAMP}` } });
  companyC = c.id;
  const oA = await prisma.organization.create({ data: { name: `idorLeadOA-${STAMP}`, companyId: companyC, partnerId: partnerA } });
  orgA = oA.id;
  const oB = await prisma.organization.create({ data: { name: `idorLeadOB-${STAMP}`, companyId: companyC, partnerId: partnerB } });
  orgB = oB.id;

  const u = await prisma.user.create({ data: { email: `idorLead-${STAMP}@x.local`, name: `Lead Author ${STAMP}` } });
  author = u.id;

  const lA = await prisma.lead.create({
    data: { partnerId: partnerA, createdByUserId: author, organizationId: orgA, clientCompanyName: 'A-client', clientContactName: 'A-contact', subject: 'A-subject' }
  });
  leadA = lA.id;
  const lB = await prisma.lead.create({
    data: { partnerId: partnerB, createdByUserId: author, organizationId: orgB, clientCompanyName: 'B-client', clientContactName: 'B-contact', subject: 'B-subject' }
  });
  leadB = lB.id;
});

afterAll(async () => {
  await prisma.lead.deleteMany({ where: { id: { in: [leadA, leadB] } } });
  await prisma.user.deleteMany({ where: { id: author } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await prisma.company.deleteMany({ where: { id: companyC } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerA, partnerB] } } });
  await prisma.$disconnect();
});

describe('E2-A — Lead by-id IDOR across partners', () => {
  it('partner B cannot read partner A lead by id → null', async () => {
    expect(await getLead(prisma, { leadId: leadA, partnerId: partnerB })).toBeNull();
  });
  it('partner A CAN read its own lead (positive control)', async () => {
    const r = await getLead(prisma, { leadId: leadA, partnerId: partnerA });
    expect(r?.id).toBe(leadA);
  });
});

describe('E2-A — Lead list IDOR across partners', () => {
  it('partner B list never contains partner A lead', async () => {
    const { rows } = await listLeads(prisma, { partnerId: partnerB, take: 50, skip: 0 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(leadB); // positive control — filter is not vacuous
    expect(ids).not.toContain(leadA);
  });
});

describe('E2-A — Lead withdraw (mutating) IDOR', () => {
  it('partner B cannot withdraw partner A lead → not_found, no mutation', async () => {
    const r = await withdrawLead(prisma, { leadId: leadA, partnerId: partnerB, reason: 'x' });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    const after = await prisma.lead.findUnique({ where: { id: leadA }, select: { status: true } });
    expect(after?.status).toBe('new'); // untouched
  });
});

describe('E2-A — scopeOrgIds (partner sub-manager) restriction', () => {
  it('a lead outside the sub-manager org scope is invisible even to its own partner', async () => {
    // leadA is in orgA; a sub-manager scoped to only orgB must not see it.
    expect(await getLead(prisma, { leadId: leadA, partnerId: partnerA, scopeOrgIds: [orgB] })).toBeNull();
  });
  it('the same lead IS visible when its org is in scope (positive control)', async () => {
    const r = await getLead(prisma, { leadId: leadA, partnerId: partnerA, scopeOrgIds: [orgA] });
    expect(r?.id).toBe(leadA);
  });
});
