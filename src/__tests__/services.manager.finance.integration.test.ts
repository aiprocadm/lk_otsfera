import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import type { SessionPayload } from '@/lib/auth/jwt';

const prisma = new PrismaClient();
const TAG = `mgrfin-it-${Date.now()}`;

let companyA = '';
let companyB = '';
let orgA = '';
let mgrA: SessionPayload;
let mgrB: SessionPayload;

beforeAll(async () => {
  const cA = await prisma.company.create({ data: { name: `${TAG}-A` } });
  const cB = await prisma.company.create({ data: { name: `${TAG}-B` } });
  companyA = cA.id;
  companyB = cB.id;
  const oA = await prisma.organization.create({
    data: { name: `${TAG}-orgA`, companyId: companyA }
  });
  orgA = oA.id;

  // org-level payment (orderId null) on orgA — exercises the PR #104 nullable-order path.
  await prisma.payment.create({
    data: {
      organizationId: orgA,
      orderId: null,
      amount: '500.00',
      paidAt: new Date('2026-04-15'),
      isRefund: false
    }
  });

  mgrA = {
    sub: `${TAG}-mA`,
    role: 'manager',
    email: 'a@x',
    companyId: companyA,
    managedOrgIds: [orgA]
  } as unknown as SessionPayload;
  mgrB = {
    sub: `${TAG}-mB`,
    role: 'manager',
    email: 'b@x',
    companyId: companyB,
    managedOrgIds: []
  } as unknown as SessionPayload;
});

afterAll(async () => {
  // FK-safe order: payments → organizations → companies.
  await prisma.payment.deleteMany({
    where: { organization: { name: { startsWith: TAG } } }
  });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.company.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe('getManagerFinanceOverview (integration)', () => {
  it('manager sees own org org-level payment (null orderId)', async () => {
    const res = await getManagerFinanceOverview(prisma, mgrA, { teamMode: false });
    const section = res.sections.find((s) => s.orgId === orgA);
    expect(section).toBeDefined();
    expect(
      section!.payments.some((p) => p.orderId === null && p.amount === '500.00')
    ).toBe(true);
  });

  it('cross-company invariant: manager B sees nothing of company A even with teamMode=ON', async () => {
    const res = await getManagerFinanceOverview(prisma, mgrB, { teamMode: true });
    expect(res.sections.find((s) => s.orgId === orgA)).toBeUndefined();
  });
});
