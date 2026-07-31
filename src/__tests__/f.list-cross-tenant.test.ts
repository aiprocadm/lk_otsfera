import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrders } from '@/lib/services/manager/orders';
import { listOrganizations } from '@/lib/services/manager/organizations';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { listDocuments } from '@/lib/services/manager/documents';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * F3 (§16 Track F) — list-level cross-tenant isolation ("доведение C4").
 *
 * Track C (c3.idor-cross-access) proved single-`id` IDOR is rejected. This file
 * extends the same guarantee to the LISTING services: a manager of company A
 * must never see company B's rows in orders / organizations / finance-payments /
 * documents — in BOTH the C8 company-wide mode (teamMode=on → `where companyId`)
 * and the per-org scoped mode (teamMode=off → 3-way managerId/managedOrgIds/
 * historical-comment OR). Two isolated tenants (A, B); every list is asserted to
 * contain its own row and NOT the foreign one, with symmetry + positive controls.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyA: string, companyB: string;
let orgA: string, orgB: string;
let orderA: string, orderB: string;
let paymentA: string, paymentB: string;
let docA: string, docB: string;

function mgrSession(companyId: string, managedOrgId: string, sub: string): SessionPayload {
  // No managerRole → ordinary member (leader/commission paths intentionally off).
  return {
    sub,
    role: 'manager',
    companyId,
    managedOrgIds: [managedOrgId],
  } as unknown as SessionPayload;
}

const sessionA = () => mgrSession(companyA, orgA, `f3-mgrA-${STAMP}`);
const sessionB = () => mgrSession(companyB, orgB, `f3-mgrB-${STAMP}`);

beforeAll(async () => {
  prisma = new PrismaClient();

  const cA = await prisma.company.create({ data: { name: `f3CA-${STAMP}` } });
  companyA = cA.id;
  const cB = await prisma.company.create({ data: { name: `f3CB-${STAMP}` } });
  companyB = cB.id;

  const oA = await prisma.organization.create({
    data: { name: `f3OA-${STAMP}`, companyId: companyA },
  });
  orgA = oA.id;
  const oB = await prisma.organization.create({
    data: { name: `f3OB-${STAMP}`, companyId: companyB },
  });
  orgB = oB.id;

  const ordA = await prisma.order.create({
    data: { title: 'f3 A-order', companyId: companyA, organizationId: orgA, totalAmount: 100000 },
  });
  orderA = ordA.id;
  const ordB = await prisma.order.create({
    data: { title: 'f3 B-order', companyId: companyB, organizationId: orgB, totalAmount: 200000 },
  });
  orderB = ordB.id;

  const payA = await prisma.payment.create({
    data: { organizationId: orgA, orderId: orderA, amount: 100000, paidAt: new Date('2026-04-10') },
  });
  paymentA = payA.id;
  const payB = await prisma.payment.create({
    data: { organizationId: orgB, orderId: orderB, amount: 200000, paidAt: new Date('2026-04-11') },
  });
  paymentB = payB.id;

  // Order-bound docs: orderId set, companyId null (XOR CHECK), counterparty = org.
  const dA = await prisma.document.create({
    data: {
      name: 'f3-A.pdf',
      path: 's3://x/fa',
      mimeType: 'application/pdf',
      type: 'contract',
      direction: 'incoming',
      orderId: orderA,
      counterpartyType: 'organization',
      counterpartyId: orgA,
      scanStatus: 'clean',
    },
  });
  docA = dA.id;
  const dB = await prisma.document.create({
    data: {
      name: 'f3-B.pdf',
      path: 's3://x/fb',
      mimeType: 'application/pdf',
      type: 'contract',
      direction: 'incoming',
      orderId: orderB,
      counterpartyType: 'organization',
      counterpartyId: orgB,
      scanStatus: 'clean',
    },
  });
  docB = dB.id;
});

afterAll(async () => {
  const orgIds = [orgA, orgB];
  await prisma.document.deleteMany({ where: { id: { in: [docA, docB] } } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.order.deleteMany({ where: { id: { in: [orderA, orderB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('F3 — orders list is company-isolated', () => {
  it('company-wide (teamMode=on): manager A gets its order, never company B', async () => {
    const { rows } = await listOrders(prisma, { session: sessionA(), teamModeOverride: true });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderA); // positive control — filter is not vacuous
    expect(ids).not.toContain(orderB);
  });
  it('scoped (teamMode=off): manager A gets its assigned-org order, never company B', async () => {
    const { rows } = await listOrders(prisma, { session: sessionA(), teamModeOverride: false });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderA);
    expect(ids).not.toContain(orderB);
  });
  it('symmetry — manager B never sees company A order (company-wide)', async () => {
    const { rows } = await listOrders(prisma, { session: sessionB(), teamModeOverride: true });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderB);
    expect(ids).not.toContain(orderA);
  });
});

describe('F3 — organizations list is company-isolated', () => {
  it('company-wide: manager A gets orgA, never orgB', async () => {
    const rows = await listOrganizations(prisma, sessionA(), true);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgA);
    expect(ids).not.toContain(orgB);
  });
  it('scoped: manager A gets orgA, never orgB', async () => {
    const rows = await listOrganizations(prisma, sessionA(), false);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orgA);
    expect(ids).not.toContain(orgB);
  });
});

describe('F3 — finance (payments) list is company-isolated', () => {
  it('company-wide: manager A finance covers orgA payments only', async () => {
    const overview = await getManagerFinanceOverview(prisma, sessionA(), { teamMode: true });
    const sectionOrgIds = overview.sections.map((s) => s.orgId);
    expect(sectionOrgIds).toContain(orgA);
    expect(sectionOrgIds).not.toContain(orgB);
    const allPaymentIds = overview.sections.flatMap((s) => s.payments.map((p) => p.id));
    expect(allPaymentIds).toContain(paymentA);
    expect(allPaymentIds).not.toContain(paymentB);
  });
  it('scoped: manager A finance covers orgA payments only', async () => {
    const overview = await getManagerFinanceOverview(prisma, sessionA(), { teamMode: false });
    const allPaymentIds = overview.sections.flatMap((s) => s.payments.map((p) => p.id));
    expect(allPaymentIds).toContain(paymentA);
    expect(allPaymentIds).not.toContain(paymentB);
  });
});

describe('F3 — documents list is company-isolated', () => {
  it('scoped (managerTeamVisibility=off): manager A gets docA, never docB', async () => {
    await prisma.company.update({
      where: { id: companyA },
      data: { managerTeamVisibility: false },
    });
    const { rows } = await listDocuments(prisma, { session: sessionA() });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(docA);
    expect(ids).not.toContain(docB);
  });
  it('company-wide (managerTeamVisibility=on): manager A gets docA, never docB', async () => {
    // listDocuments derives teamMode from the live Company flag (no override arg).
    await prisma.company.update({ where: { id: companyA }, data: { managerTeamVisibility: true } });
    const { rows } = await listDocuments(prisma, { session: sessionA() });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(docA);
    expect(ids).not.toContain(docB);
  });
});
