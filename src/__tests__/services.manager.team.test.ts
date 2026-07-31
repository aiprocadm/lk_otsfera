import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listManagersForOrg } from '@/lib/services/manager/team';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let orgWithMixId: string;
let orgEmptyId: string;
let activeUserId: string;
let inactiveUserId: string;
let mostRecentInactiveUserId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrTeamC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrTeamP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const orgWithMix = await prisma.organization.create({
    data: { name: `MgrTeam-Mix-${stamp}`, partnerId, companyId },
  });
  orgWithMixId = orgWithMix.id;
  const orgEmpty = await prisma.organization.create({
    data: { name: `MgrTeam-Empty-${stamp}`, partnerId, companyId },
  });
  orgEmptyId = orgEmpty.id;

  const activeUser = await prisma.user.create({
    data: {
      email: `mgr-team-active-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Active Mgr',
      role: 'manager',
    },
  });
  activeUserId = activeUser.id;
  const inactiveUser = await prisma.user.create({
    data: {
      email: `mgr-team-inactive-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Old Mgr',
      role: 'manager',
    },
  });
  inactiveUserId = inactiveUser.id;
  const mostRecentInactiveUser = await prisma.user.create({
    data: {
      email: `mgr-team-recent-inactive-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Recent Old Mgr',
      role: 'manager',
    },
  });
  mostRecentInactiveUserId = mostRecentInactiveUser.id;

  // Active assignment.
  await prisma.organizationManager.create({
    data: {
      organizationId: orgWithMixId,
      userId: activeUserId,
      isActive: true,
    },
  });
  // First-deactivated (older deactivatedAt).
  await prisma.organizationManager.create({
    data: {
      organizationId: orgWithMixId,
      userId: inactiveUserId,
      isActive: false,
      deactivatedAt: new Date('2026-01-01T10:00:00Z'),
    },
  });
  // Most-recently-deactivated.
  await prisma.organizationManager.create({
    data: {
      organizationId: orgWithMixId,
      userId: mostRecentInactiveUserId,
      isActive: false,
      deactivatedAt: new Date('2026-04-15T10:00:00Z'),
    },
  });
});

afterAll(async () => {
  const userIds = [activeUserId, inactiveUserId, mostRecentInactiveUserId];
  const orgIds = [orgWithMixId, orgEmptyId];

  await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/manager/team — listManagersForOrg', () => {
  it('returns empty buckets when the organization has no assignments', async () => {
    const result = await listManagersForOrg(prisma, orgEmptyId);
    expect(result).toEqual({ active: [], inactive: [] });
  });

  it('splits rows into active and inactive buckets', async () => {
    const { active, inactive } = await listManagersForOrg(prisma, orgWithMixId);
    expect(active).toHaveLength(1);
    expect(inactive).toHaveLength(2);

    expect(active[0].userId).toBe(activeUserId);
    expect(active[0].isActive).toBe(true);

    expect(inactive.every((row) => row.isActive === false)).toBe(true);
  });

  it('includes nested user payload (id, name, email, isActive) for UI rendering', async () => {
    const { active } = await listManagersForOrg(prisma, orgWithMixId);
    const row = active[0];
    expect(row.user.id).toBe(activeUserId);
    expect(row.user.email).toMatch(/^mgr-team-active-/);
    expect(row.user.name).toBe('Active Mgr');
    expect(row.user.isActive).toBe(true);
  });

  it('sorts inactive rows by deactivatedAt desc (most recent first)', async () => {
    const { inactive } = await listManagersForOrg(prisma, orgWithMixId);
    expect(inactive.map((r) => r.userId)).toEqual([mostRecentInactiveUserId, inactiveUserId]);
  });
});
