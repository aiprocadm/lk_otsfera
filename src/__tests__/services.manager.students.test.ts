import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listStudents } from '@/lib/services/manager/students';
import type { SessionPayload } from '@/lib/auth/jwt';

let prisma: PrismaClient;

let companyId: string;
let partnerId: string;
let orgAId: string;
let orgBId: string;
let orgCId: string;
let userAId: string;
let userBId: string;
let userGhostId: string;

let stuA1Id: string;
let stuA2Id: string;
let stuB1Id: string;
let stuCId: string;

function managerSession(userId: string, managedOrgIds: string[]): SessionPayload {
  return { sub: userId, role: 'manager', managedOrgIds };
}

beforeAll(async () => {
  prisma = new PrismaClient();
  const stamp = Date.now();

  const company = await prisma.company.create({ data: { name: `MgrStudC-${stamp}` } });
  companyId = company.id;
  const partner = await prisma.partner.create({
    data: { name: `MgrStudP-${stamp}`, commissionRate: 0.1 },
  });
  partnerId = partner.id;

  const orgA = await prisma.organization.create({
    data: { name: `MgrStud-AAA-${stamp}`, partnerId, companyId },
  });
  orgAId = orgA.id;
  const orgB = await prisma.organization.create({
    data: { name: `MgrStud-BBB-${stamp}`, partnerId, companyId },
  });
  orgBId = orgB.id;
  // orgC is *not* assigned to any test user — it's used to assert out-of-scope
  // visibility (its students must never leak into a manager-scoped query).
  const orgC = await prisma.organization.create({
    data: { name: `MgrStud-CCC-${stamp}`, partnerId, companyId },
  });
  orgCId = orgC.id;

  const userA = await prisma.user.create({
    data: {
      email: `mgr-stud-a-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager A',
      role: 'manager',
    },
  });
  userAId = userA.id;
  const userB = await prisma.user.create({
    data: {
      email: `mgr-stud-b-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Manager B',
      role: 'manager',
    },
  });
  userBId = userB.id;
  const userGhost = await prisma.user.create({
    data: {
      email: `mgr-stud-ghost-${stamp}@t.local`,
      passwordHash: 'x',
      name: 'Ghost Manager',
      role: 'manager',
    },
  });
  userGhostId = userGhost.id;

  // userA → orgA + orgB (multi-assignment manager), userB → orgB only.
  await prisma.organizationManager.create({
    data: { organizationId: orgAId, userId: userAId, isActive: true },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userAId, isActive: true },
  });
  await prisma.organizationManager.create({
    data: { organizationId: orgBId, userId: userBId, isActive: true },
  });

  const stuA1 = await prisma.student.create({
    data: {
      email: `mgr-stud-a1-${stamp}@t.local`,
      name: 'Иванов Иван',
      organizationId: orgAId,
      externalStudentId: `EXT-A1-${stamp}`,
    },
  });
  stuA1Id = stuA1.id;
  const stuA2 = await prisma.student.create({
    data: {
      email: `mgr-stud-a2-${stamp}@t.local`,
      name: 'Петров Пётр',
      organizationId: orgAId,
    },
  });
  stuA2Id = stuA2.id;
  const stuB1 = await prisma.student.create({
    data: {
      email: `mgr-stud-b1-${stamp}@t.local`,
      name: 'Сидорова Анна',
      organizationId: orgBId,
    },
  });
  stuB1Id = stuB1.id;
  const stuC = await prisma.student.create({
    data: {
      email: `mgr-stud-c-${stamp}@t.local`,
      name: 'Кузнецов Семён',
      organizationId: orgCId,
    },
  });
  stuCId = stuC.id;
});

afterAll(async () => {
  const userIds = [userAId, userBId, userGhostId];
  const orgIds = [orgAId, orgBId, orgCId];
  const studentIds = [stuA1Id, stuA2Id, stuB1Id, stuCId];

  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
  await prisma.organizationManager.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.partner.delete({ where: { id: partnerId } });
  await prisma.company.delete({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('services/manager/students — RBAC scope', () => {
  it('multi-assignment manager sees students of all managed orgs (orgA + orgB), orgC excluded', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const { rows } = await listStudents(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(stuA1Id);
    expect(ids).toContain(stuA2Id);
    expect(ids).toContain(stuB1Id);
    expect(ids).not.toContain(stuCId);
  });

  it('single-assignment manager sees only own org students (orgB)', async () => {
    const session = managerSession(userBId, [orgBId]);
    const { rows } = await listStudents(prisma, { session, take: 100 });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([stuB1Id]);
  });

  it('assignmentless manager (empty managedOrgIds) sees no students', async () => {
    const session = managerSession(userGhostId, []);
    const { rows } = await listStudents(prisma, { session, take: 100 });
    expect(rows).toEqual([]);
  });

  it('includes organization { id, name } on each row', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const { rows } = await listStudents(prisma, { session, take: 100 });
    const a1 = rows.find((r) => r.id === stuA1Id)!;
    expect(a1.organization.id).toBe(orgAId);
    expect(a1.organization.name).toContain('MgrStud-AAA-');
  });
});

describe('services/manager/students — filters & pagination', () => {
  it('filters by q on name (case-insensitive ILIKE) within scope', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const { rows } = await listStudents(prisma, { session, q: 'иванов', take: 100 });
    expect(rows.map((r) => r.id)).toEqual([stuA1Id]);
  });

  it('filters by q on email (case-insensitive ILIKE) within scope', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const { rows } = await listStudents(prisma, { session, q: 'mgr-stud-b1', take: 100 });
    expect(rows.map((r) => r.id)).toEqual([stuB1Id]);
  });

  it('q matching a foreign-org student does not leak (scope wins)', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const { rows } = await listStudents(prisma, { session, q: 'Кузнецов', take: 100 });
    expect(rows).toEqual([]);
  });

  it('paginates with cursor', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    const first = await listStudents(prisma, { session, take: 1 });
    expect(first.rows.length).toBe(1);
    expect(first.nextCursor).not.toBeNull();
    const second = await listStudents(prisma, {
      session,
      take: 1,
      cursor: first.nextCursor!,
    });
    expect(second.rows.length).toBe(1);
    expect(second.rows[0]!.id).not.toBe(first.rows[0]!.id);
  });

  it('rejects take > 100 via zod validation', async () => {
    const session = managerSession(userAId, [orgAId, orgBId]);
    await expect(listStudents(prisma, { session, take: 9999 })).rejects.toThrow();
  });
});
