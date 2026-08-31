import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { getStatementWithItems } from '@/lib/services/partner/finance';
import { approveStatement } from '@/lib/services/commission/lifecycle';
import { listOrgPayments } from '@/lib/services/organization/finance';
import { listOrgDocuments, getOrgDocumentForDownload } from '@/lib/services/organization/documents';
import { organizationOrderScopeFilter } from '@/lib/auth/organizationPolicy';
import { partnerOrgScopeFilter } from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * C3 (§3.4/§16) — IDOR-покрытие: запрос по ЧУЖОМУ id отклоняется на каждом из
 * ресурсов Order / Document / Payment / CommissionStatement через существующие
 * scope-фильтры и сервисные проверки принадлежности. Два изолированных тенанта
 * (A и B): объект A не виден из контекста B и наоборот.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

// Tenant A
let partnerA: string, companyA: string, orgA: string;
let orderA: string, paymentA: string, docA: string, commDocA: string, stmtA: string;
// Tenant B
let partnerB: string, companyB: string, orgB: string;

function orgSession(organizationId: string): SessionPayload {
  return {
    sub: `u-${organizationId}`,
    role: 'organization',
    organizationId,
    organizationMemberships: [{ organizationId, roleInOrg: 'member', isActive: true }],
  } as unknown as SessionPayload;
}
function partnerSession(partnerId: string): SessionPayload {
  return {
    sub: `u-${partnerId}`,
    role: 'partner',
    partnerId,
    assignedOrgIds: [],
  } as unknown as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const pA = await prisma.partner.create({
    data: { name: `idorPA-${STAMP}`, commissionRate: new Prisma.Decimal('0.1') },
  });
  partnerA = pA.id;
  const cA = await prisma.company.create({ data: { name: `idorCA-${STAMP}` } });
  companyA = cA.id;
  const oA = await prisma.organization.create({
    data: { name: `idorOA-${STAMP}`, partnerId: partnerA, companyId: companyA },
  });
  orgA = oA.id;

  const pB = await prisma.partner.create({
    data: { name: `idorPB-${STAMP}`, commissionRate: new Prisma.Decimal('0.2') },
  });
  partnerB = pB.id;
  const cB = await prisma.company.create({ data: { name: `idorCB-${STAMP}` } });
  companyB = cB.id;
  const oB = await prisma.organization.create({
    data: { name: `idorOB-${STAMP}`, partnerId: partnerB, companyId: companyB },
  });
  orgB = oB.id;

  const ordA = await prisma.order.create({
    data: {
      title: 'A-order',
      companyId: companyA,
      organizationId: orgA,
      partnerId: partnerA,
      totalAmount: 100000,
      financialStatus: 'paid',
    },
  });
  orderA = ordA.id;
  const payA = await prisma.payment.create({
    data: { organizationId: orgA, orderId: orderA, amount: 100000, paidAt: new Date('2026-04-10') },
  });
  paymentA = payA.id;

  // Org-channel document for tenant A (the org legitimately sees this).
  const dA = await prisma.document.create({
    data: {
      name: 'A-contract.pdf',
      path: 's3://x/a',
      mimeType: 'application/pdf',
      type: 'contract',
      direction: 'incoming',
      orderId: orderA,
      companyId: companyA,
      counterpartyType: 'organization',
      counterpartyId: orgA,
      scanStatus: 'clean',
    },
  });
  docA = dA.id;

  // Partner-channel COMMISSION document bolted to tenant A's order — must stay
  // invisible to the organization (C1 behavioral proof).
  const cd = await prisma.document.create({
    data: {
      name: 'A-commission.pdf',
      path: 's3://x/comm',
      mimeType: 'application/pdf',
      type: 'commission_statement',
      direction: 'outgoing',
      orderId: orderA,
      // Канал партнёрский (counterparty — партнёр), но компания-исполнитель у
      // документа заказа обязана совпадать с компанией самого заказа: companyA.
      companyId: companyA,
      counterpartyType: 'partner',
      counterpartyId: partnerA,
      scanStatus: 'clean',
    },
  });
  commDocA = cd.id;

  const st = await prisma.commissionStatement.create({
    data: {
      partnerId: partnerA,
      periodFrom: new Date('2026-04-01'),
      periodTo: new Date('2026-04-30'),
      totalBaseAmount: 100000,
      averageRate: 0.1,
      totalCommissionAmount: 10000,
      status: 'draft',
    },
  });
  stmtA = st.id;
});

afterAll(async () => {
  const partnerIds = [partnerA, partnerB];
  const orgIds = [orgA, orgB];
  await prisma.commissionStatementItem.deleteMany({
    where: { statement: { partnerId: { in: partnerIds } } },
  });
  await prisma.commissionStatement.deleteMany({ where: { partnerId: { in: partnerIds } } });
  await prisma.document.deleteMany({ where: { id: { in: [docA, commDocA] } } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.order.deleteMany({ where: { partnerId: { in: partnerIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('C3 — Order IDOR', () => {
  it('org B cannot reach tenant A order via the org scope filter', async () => {
    const hit = await prisma.order.findFirst({
      where: { id: orderA, ...organizationOrderScopeFilter(orgSession(orgB)) },
      select: { id: true },
    });
    expect(hit).toBeNull();
  });
  it('org A CAN reach its own order (positive control)', async () => {
    const hit = await prisma.order.findFirst({
      where: { id: orderA, ...organizationOrderScopeFilter(orgSession(orgA)) },
      select: { id: true },
    });
    expect(hit?.id).toBe(orderA);
  });
  it('partner B cannot reach tenant A order via the partner scope filter', async () => {
    const hit = await prisma.order.findFirst({
      where: { id: orderA, ...partnerOrgScopeFilter(partnerSession(partnerB)) },
      select: { id: true },
    });
    expect(hit).toBeNull();
  });
});

describe('C3 — Payment IDOR', () => {
  it('org B payment ledger never contains tenant A payment', async () => {
    const rows = await listOrgPayments(prisma, { organizationId: orgB });
    expect(rows.some((r) => r.id === paymentA)).toBe(false);
  });
  it('org A payment ledger contains its own payment (positive control)', async () => {
    const rows = await listOrgPayments(prisma, { organizationId: orgA });
    expect(rows.some((r) => r.id === paymentA)).toBe(true);
  });
});

describe('C3 — Document IDOR + channel isolation', () => {
  it('org B cannot download tenant A org-channel document → not_found', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgB, docA);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
  it('org A CAN download its own org-channel document (positive control)', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgA, docA);
    expect(r.ok).toBe(true);
  });
  it('C1: the partner-channel commission document is invisible to its own org (list)', async () => {
    const { rows } = await listOrgDocuments(prisma, { organizationId: orgA, orderId: orderA });
    expect(rows.some((d) => d.id === commDocA)).toBe(false);
    // …but the org-channel contract IS listed, proving the filter is not vacuous.
    expect(rows.some((d) => d.id === docA)).toBe(true);
  });
  it('C1: the org cannot download the partner-channel commission document → not_found', async () => {
    const r = await getOrgDocumentForDownload(prisma, orgA, commDocA);
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('C3 — CommissionStatement IDOR', () => {
  it('partner B cannot read tenant A statement by id → null', async () => {
    const r = await getStatementWithItems(prisma, stmtA, partnerB);
    expect(r).toBeNull();
  });
  it('partner A CAN read its own statement (positive control)', async () => {
    const r = await getStatementWithItems(prisma, stmtA, partnerA);
    expect(r?.id).toBe(stmtA);
  });

  // The mutating path also takes a foreign statement id — ownership is enforced by
  // the {id, partnerId} filter in approveStatement, so a cross-partner approve must
  // be rejected (not_found), not silently succeed.
  it('partner B cannot approve tenant A statement by id → not_found (no mutation)', async () => {
    const r = await approveStatement(prisma, {
      statementId: stmtA,
      partnerId: partnerB,
      approvedByUserId: `u-${partnerB}`,
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    // The statement stayed a draft — the cross-partner call did not mutate it.
    const after = await prisma.commissionStatement.findUnique({
      where: { id: stmtA },
      select: { status: true },
    });
    expect(after?.status).toBe('draft');
  });
});
