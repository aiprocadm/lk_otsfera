import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveOrgManagerRecipients } from '@/lib/notifications/manager';

let prisma: PrismaClient;
let companyId: string, orgId: string, mgrId: string;
// Isolation fixtures
let companyOtherId: string, orgOtherId: string, mgrOtherId: string;
let mgrInactiveId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();

  // Primary fixture: company + org + active manager assigned to org
  const c = await prisma.company.create({ data: { name: `NMC-${s}` } });
  companyId = c.id;
  const org = await prisma.organization.create({ data: { name: `NMO-${s}`, companyId } });
  orgId = org.id;
  const m = await prisma.user.create({ data: { email: `nm-${s}@x.io`, name: 'NM Mgr', role: 'manager', companyId, isActive: true } });
  mgrId = m.id;
  await prisma.organizationManager.create({ data: { organizationId: orgId, userId: mgrId, isActive: true } });

  // Isolation fixture A: manager assigned to a DIFFERENT org (different company)
  const cOther = await prisma.company.create({ data: { name: `NMC-other-${s}` } });
  companyOtherId = cOther.id;
  const orgOther = await prisma.organization.create({ data: { name: `NMO-other-${s}`, companyId: companyOtherId } });
  orgOtherId = orgOther.id;
  const mOther = await prisma.user.create({ data: { email: `nm-other-${s}@x.io`, name: 'NM Other Mgr', role: 'manager', companyId: companyOtherId, isActive: true } });
  mgrOtherId = mOther.id;
  await prisma.organizationManager.create({ data: { organizationId: orgOtherId, userId: mgrOtherId, isActive: true } });

  // Isolation fixture B: manager with isActive=false for orgId
  const mInactive = await prisma.user.create({ data: { email: `nm-inactive-${s}@x.io`, name: 'NM Inactive Mgr', role: 'manager', companyId, isActive: true } });
  mgrInactiveId = mInactive.id;
  await prisma.organizationManager.create({ data: { organizationId: orgId, userId: mgrInactiveId, isActive: false } });
});

afterAll(async () => {
  // Delete OrganizationManager rows before users/orgs/companies
  await prisma.organizationManager.deleteMany({ where: { userId: { in: [mgrId, mgrInactiveId] } } });
  await prisma.organizationManager.deleteMany({ where: { userId: mgrOtherId } });
  await prisma.user.deleteMany({ where: { id: { in: [mgrId, mgrInactiveId] } } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.user.delete({ where: { id: mgrOtherId } });
  await prisma.organization.delete({ where: { id: orgOtherId } });
  await prisma.company.delete({ where: { id: companyOtherId } });
  await prisma.$disconnect();
});

describe('resolveOrgManagerRecipients', () => {
  it('returns active managers assigned to the org', async () => {
    const recips = await resolveOrgManagerRecipients(prisma, orgId);
    expect(recips.map((r) => r.id)).toContain(mgrId);
  });

  it('does NOT return a manager assigned to a different organization', async () => {
    const recips = await resolveOrgManagerRecipients(prisma, orgId);
    expect(recips.map((r) => r.id)).not.toContain(mgrOtherId);
  });

  it('does NOT return a manager whose OrganizationManager.isActive is false for the org', async () => {
    const recips = await resolveOrgManagerRecipients(prisma, orgId);
    expect(recips.map((r) => r.id)).not.toContain(mgrInactiveId);
  });
});
