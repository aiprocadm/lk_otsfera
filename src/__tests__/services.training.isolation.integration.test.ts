import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listCertificates } from '@/lib/services/training';

const prisma = new PrismaClient();
const ids: Record<string, string> = {};

beforeAll(async () => {
  const dir = await prisma.trainingDirection.create({ data: { name: 'ОТ-iso' } });
  const company = await prisma.company.create({ data: { name: 'iso-co' } });
  const orgA = await prisma.organization.create({ data: { name: 'orgA', companyId: company.id } });
  const orgB = await prisma.organization.create({ data: { name: 'orgB', companyId: company.id } });
  const stA = await prisma.student.create({
    data: { name: 'A', email: 'a@iso.ru', organizationId: orgA.id },
  });
  const stB = await prisma.student.create({
    data: { name: 'B', email: 'b@iso.ru', organizationId: orgB.id },
  });
  await prisma.certificate.create({
    data: {
      studentId: stA.id,
      organizationId: orgA.id,
      directionId: dir.id,
      number: 'A1',
      issuedAt: new Date(),
    },
  });
  await prisma.certificate.create({
    data: {
      studentId: stB.id,
      organizationId: orgB.id,
      directionId: dir.id,
      number: 'B1',
      issuedAt: new Date(),
    },
  });
  Object.assign(ids, {
    dir: dir.id,
    company: company.id,
    orgA: orgA.id,
    orgB: orgB.id,
    stA: stA.id,
    stB: stB.id,
  });
});

afterAll(async () => {
  await prisma.certificate.deleteMany({ where: { organizationId: { in: [ids.orgA, ids.orgB] } } });
  await prisma.student.deleteMany({ where: { id: { in: [ids.stA, ids.stB] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [ids.orgA, ids.orgB] } } });
  await prisma.company.delete({ where: { id: ids.company } });
  await prisma.trainingDirection.delete({ where: { id: ids.dir } });
  await prisma.$disconnect();
});

describe('training cross-org isolation', () => {
  it('менеджер orgA не видит удостоверения orgB', async () => {
    const session = {
      sub: 'm1',
      role: 'manager',
      managerRole: null,
      companyId: ids.company,
      managedOrgIds: [ids.orgA],
    } as any;
    const res = await listCertificates(prisma, session, {});
    expect(res.ok).toBe(true);
    if (res.ok) {
      const orgs = new Set(res.certificates.map((c) => c.organizationId));
      expect(orgs.has(ids.orgB)).toBe(false);
      expect(orgs.has(ids.orgA)).toBe(true);
    }
  });
});
