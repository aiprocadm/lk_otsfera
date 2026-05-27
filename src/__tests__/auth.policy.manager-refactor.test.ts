import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { canAccessOrganization, canReadOrder } from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let otherPartnerId: string;
let managerUserId: string;

let org1Id: string;
let otherOrgId: string;

let order1Id: string; // managerId = managerUserId, organizationId = otherOrgId (per-order ownership across orgs)
let order2Id: string; // organizationId = org1Id, managerId = null (per-org scope)
let order3Id: string; // organizationId = otherOrgId, managerId = null (out of scope)

// Helper: builds a SessionPayload that mirrors what login.ts produces after Task 4.
function managerSession(managedOrgIds: string[]): SessionPayload {
  return {
    sub: managerUserId,
    role: 'manager',
    managedOrgIds,
  };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrPolicyC-${stamp}` } });
  companyId = company.id;

  const partner = await prisma.partner.create({
    data: { name: `MgrPolicyP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;
  const otherPartner = await prisma.partner.create({
    data: { name: `MgrPolicyOtherP-${stamp}`, commissionRate: 0.1 },
  });
  otherPartnerId = otherPartner.id;

  const org1 = await prisma.organization.create({
    data: { name: `MgrPolicyOrg1-${stamp}`, partnerId, companyId },
  });
  org1Id = org1.id;

  const otherOrg = await prisma.organization.create({
    data: { name: `MgrPolicyOtherOrg-${stamp}`, partnerId: otherPartnerId, companyId },
  });
  otherOrgId = otherOrg.id;

  const manager = await prisma.user.create({
    data: {
      email: `policy-mgr-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Policy Manager',
      role: 'manager',
    },
  });
  managerUserId = manager.id;

  // Activate per-org assignment via OrganizationManager (NOT OrganizationUser — that's the bug we fix).
  await prisma.organizationManager.create({
    data: { organizationId: org1Id, userId: managerUserId, isActive: true },
  });

  // order1: per-order ownership. Note: organizationId is otherOrgId so that this case
  // exercises the per-order path WITHOUT being also rescued by per-org scope.
  const order1 = await prisma.order.create({
    data: {
      title: `MgrPolicy-Order1-${stamp}`,
      orderNumber: `MP1-${stamp}`,
      companyId,
      partnerId: otherPartnerId,
      organizationId: otherOrgId,
      managerId: managerUserId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  order1Id = order1.id;

  // order2: per-org scope (org1 ∈ managedOrgIds), no per-order assignment.
  const order2 = await prisma.order.create({
    data: {
      title: `MgrPolicy-Order2-${stamp}`,
      orderNumber: `MP2-${stamp}`,
      companyId,
      partnerId,
      organizationId: org1Id,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  order2Id = order2.id;

  // order3: in a foreign organization, no per-order assignment — out of scope.
  const order3 = await prisma.order.create({
    data: {
      title: `MgrPolicy-Order3-${stamp}`,
      orderNumber: `MP3-${stamp}`,
      companyId,
      partnerId: otherPartnerId,
      organizationId: otherOrgId,
      executionStatus: 'in_progress',
      financialStatus: 'not_billed',
    },
  });
  order3Id = order3.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: [order1Id, order2Id, order3Id] } } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerUserId } });
  await prisma.user.deleteMany({ where: { id: managerUserId } });
  await prisma.organization.deleteMany({ where: { id: { in: [org1Id, otherOrgId] } } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerId, otherPartnerId] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('policy.canReadOrder — manager branch', () => {
  it('returns true for per-order ownership (Order.managerId = session.sub)', async () => {
    const session = managerSession([org1Id]);
    const result = await canReadOrder(session, { id: order1Id, companyId });
    expect(result).toBe(true);
  });

  it('returns true for per-org scope (Order.organizationId ∈ session.managedOrgIds)', async () => {
    const session = managerSession([org1Id]);
    const result = await canReadOrder(session, { id: order2Id, companyId });
    expect(result).toBe(true);
  });

  it('returns false for order in foreign org with no per-order assignment', async () => {
    const session = managerSession([org1Id]);
    const result = await canReadOrder(session, { id: order3Id, companyId });
    expect(result).toBe(false);
  });

  it('returns false when the order id does not exist', async () => {
    const session = managerSession([org1Id]);
    const result = await canReadOrder(session, { id: 'does-not-exist', companyId });
    expect(result).toBe(false);
  });

  it('returns false after deactivation (simulated post-relogin: empty managedOrgIds) for per-org order', async () => {
    // managedOrgIds is JWT-cached; deactivation only takes effect after re-login.
    // We simulate that re-loaded session by passing managedOrgIds=[] directly.
    const reloadedSession = managerSession([]);
    const result = await canReadOrder(reloadedSession, { id: order2Id, companyId });
    expect(result).toBe(false);
  });

  it('per-order ownership still works even with empty managedOrgIds (e.g. assignment-less manager)', async () => {
    const reloadedSession = managerSession([]);
    const result = await canReadOrder(reloadedSession, { id: order1Id, companyId });
    expect(result).toBe(true);
  });
});

describe('policy.canAccessOrganization — manager branch', () => {
  it('returns true for org in session.managedOrgIds', async () => {
    const session = managerSession([org1Id]);
    expect(await canAccessOrganization(session, org1Id)).toBe(true);
  });

  it('returns false for foreign org', async () => {
    const session = managerSession([org1Id]);
    expect(await canAccessOrganization(session, otherOrgId)).toBe(false);
  });

  it('returns false after deactivation (simulated post-relogin: empty managedOrgIds)', async () => {
    const reloadedSession = managerSession([]);
    expect(await canAccessOrganization(reloadedSession, org1Id)).toBe(false);
  });

  it('returns false for null/undefined organizationId', async () => {
    const session = managerSession([org1Id]);
    expect(await canAccessOrganization(session, null)).toBe(false);
    expect(await canAccessOrganization(session, undefined)).toBe(false);
  });
});
