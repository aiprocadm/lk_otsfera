import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrgStudents } from '@/lib/services/organization/students';

let prisma: PrismaClient;
let partnerId: string;
let companyId: string;
let orgAId: string;
let orgBId: string;

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();
  const partner = await prisma.partner.create({
    data: { name: `OrgStudP-${stamp}`, commissionRate: 0.1 }
  });
  partnerId = partner.id;
  const company = await prisma.company.create({ data: { name: `OrgStudC-${stamp}` } });
  companyId = company.id;
  const a = await prisma.organization.create({
    data: { name: `StudA-${stamp}`, partnerId, companyId }
  });
  const b = await prisma.organization.create({
    data: { name: `StudB-${stamp}`, partnerId, companyId }
  });
  orgAId = a.id;
  orgBId = b.id;

  await prisma.student.create({
    data: {
      email: `ivan-${stamp}@t.local`,
      name: 'Иван Петров',
      organizationId: orgAId,
      externalStudentId: 'EXT-001'
    }
  });
  await prisma.student.create({
    data: {
      email: `mary-${stamp}@t.local`,
      name: 'Мария Смирнова',
      organizationId: orgAId
    }
  });
  await prisma.student.create({
    data: {
      email: `boris-${stamp}@t.local`,
      name: 'Борис Сидоров',
      organizationId: orgBId
    }
  });
});

afterAll(async () => {
  await prisma.student.deleteMany({
    where: { organizationId: { in: [orgAId, orgBId] } }
  });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/organization/students — listOrgStudents', () => {
  it('returns only students of the requested organization', async () => {
    const { rows, total } = await listOrgStudents(prisma, { organizationId: orgAId });
    expect(total).toBe(2);
    expect(rows.map((r) => r.name).sort()).toEqual(['Иван Петров', 'Мария Смирнова']);
  });

  it('does not leak students from foreign org', async () => {
    const { rows } = await listOrgStudents(prisma, { organizationId: orgAId });
    expect(rows.some((r) => r.name === 'Борис Сидоров')).toBe(false);
  });

  it('returns 1 student for orgB', async () => {
    const { rows, total } = await listOrgStudents(prisma, { organizationId: orgBId });
    expect(total).toBe(1);
    expect(rows[0]!.name).toBe('Борис Сидоров');
  });

  it('search by name (case-insensitive)', async () => {
    const { rows, total } = await listOrgStudents(prisma, {
      organizationId: orgAId,
      search: 'ИВАН'
    });
    expect(total).toBe(1);
    expect(rows[0]!.name).toBe('Иван Петров');
  });

  it('search by email', async () => {
    const { rows } = await listOrgStudents(prisma, {
      organizationId: orgAId,
      search: 'mary'
    });
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toBe('Мария Смирнова');
  });

  it('exposes externalStudentId when present', async () => {
    const { rows } = await listOrgStudents(prisma, {
      organizationId: orgAId,
      search: 'Иван'
    });
    expect(rows[0]!.externalStudentId).toBe('EXT-001');
  });

  it('clamps oversized take', async () => {
    const { rows } = await listOrgStudents(prisma, { organizationId: orgAId, take: 9999 });
    expect(rows.length).toBeLessThanOrEqual(200);
  });

  it('returns empty arrays for org without students', async () => {
    const stamp = Date.now();
    const empty = await prisma.organization.create({
      data: { name: `Empty-${stamp}`, partnerId, companyId }
    });
    try {
      const { rows, total } = await listOrgStudents(prisma, { organizationId: empty.id });
      expect(total).toBe(0);
      expect(rows).toEqual([]);
    } finally {
      await prisma.organization.delete({ where: { id: empty.id } });
    }
  });
});
