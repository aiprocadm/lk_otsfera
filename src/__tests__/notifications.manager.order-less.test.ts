import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { resolveCompanyManagerRecipients } from '@/lib/notifications/manager';

let prisma: PrismaClient;
let companyId: string, orgId: string, mgrId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  const c = await prisma.company.create({ data: { name: `NMC-${s}` } });
  companyId = c.id;
  const org = await prisma.organization.create({ data: { name: `NMO-${s}`, companyId } });
  orgId = org.id;
  const m = await prisma.user.create({ data: { email: `nm-${s}@x.io`, name: 'NM Mgr', role: 'manager', companyId, isActive: true } });
  mgrId = m.id;
  await prisma.organizationManager.create({ data: { organizationId: orgId, userId: mgrId, isActive: true } });
});
afterAll(async () => {
  await prisma.organizationManager.deleteMany({ where: { userId: mgrId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: mgrId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('resolveCompanyManagerRecipients', () => {
  it('returns active managers assigned to orgs in the company', async () => {
    const recips = await resolveCompanyManagerRecipients(prisma, orgId);
    expect(recips.map((r) => r.id)).toContain(mgrId);
  });
});
