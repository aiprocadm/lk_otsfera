import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';

let prisma: PrismaClient;
let companyId: string,
  otherCompanyId: string,
  orgId: string,
  partnerInCompany: string,
  partnerOther: string,
  mgrId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const s = Date.now();
  const company = await prisma.company.create({ data: { name: `CPC-${s}` } });
  companyId = company.id;
  const other = await prisma.company.create({ data: { name: `CPO-${s}` } });
  otherCompanyId = other.id;
  const pIn = await prisma.partner.create({ data: { name: `CPpin-${s}`, commissionRate: 0 } });
  partnerInCompany = pIn.id;
  const pOut = await prisma.partner.create({ data: { name: `CPpout-${s}`, commissionRate: 0 } });
  partnerOther = pOut.id;
  const org = await prisma.organization.create({
    data: { name: `CPorg-${s}`, companyId, partnerId: partnerInCompany },
  });
  orgId = org.id;
  const orgOther = await prisma.organization.create({
    data: { name: `CPorg2-${s}`, companyId: otherCompanyId },
  });
  await prisma.order.create({
    data: {
      title: 'o',
      companyId: otherCompanyId,
      organizationId: orgOther.id,
      partnerId: partnerOther,
    },
  });
  const mgr = await prisma.user.create({
    data: { email: `cpm-${s}@x.io`, name: 'CP Mgr', role: 'manager', companyId, isActive: true },
  });
  mgrId = mgr.id;
  await prisma.organizationManager.create({
    data: { organizationId: orgId, userId: mgrId, isActive: true },
  });
});

afterAll(async () => {
  await prisma.organizationManager.deleteMany({ where: { userId: mgrId } });
  await prisma.order.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.organization.deleteMany({
    where: { companyId: { in: [companyId, otherCompanyId] } },
  });
  await prisma.user.delete({ where: { id: mgrId } });
  await prisma.partner.deleteMany({ where: { id: { in: [partnerInCompany, partnerOther] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

describe('listManagerCounterparties', () => {
  it('returns managed orgs and partners whose company-union includes the manager company', async () => {
    const session = { sub: mgrId, role: 'manager', companyId, managedOrgIds: [orgId] } as never;
    const res = await listManagerCounterparties(prisma, session);
    expect(res.organizations.map((o) => o.id)).toContain(orgId);
    expect(res.partners.map((p) => p.id)).toContain(partnerInCompany);
    expect(res.partners.map((p) => p.id)).not.toContain(partnerOther);
  });
});
