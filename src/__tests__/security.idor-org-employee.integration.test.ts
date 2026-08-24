import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrgCardEmployee } from '@/lib/services/organization/orgCardEmployees';

/**
 * `У-97`: карточка сотрудника открывается по адресу вида
 * `/…/organizations/<организация>/students/<сотрудник>`. Организация в адресе
 * — граница, а не украшение: подставив в СВОЙ адрес чужой `studentId`, человек
 * не должен увидеть ничего.
 *
 * Проба на живом Postgres: две организации в разных компаниях, в каждой свой
 * сотрудник. Менеджер закреплён за одной.
 */
const prisma = new PrismaClient();
const STAMP = Date.now();

let ownCompanyId = '';
let foreignCompanyId = '';
let ownOrgId = '';
let foreignOrgId = '';
let ownStudentId = '';
let foreignStudentId = '';
let managerId = '';

const manager = (orgIds: string[]): SessionPayload =>
  ({
    sub: managerId,
    role: 'manager',
    companyId: ownCompanyId,
    managedOrgIds: orgIds,
  }) as SessionPayload;

beforeAll(async () => {
  // Журнал ПДн — поведенческий флаг: в тестовом окружении он не выставлен, и
  // запись была бы no-op. Включаем явно, иначе проверка журнала ничего не
  // проверяет (и молча зеленеет).
  process.env.FEATURE_PII_ACCESS_LOG = '1';
  const own = await prisma.company.create({ data: { name: `Своя ${STAMP}` } });
  const foreign = await prisma.company.create({ data: { name: `Чужая ${STAMP}` } });
  ownCompanyId = own.id;
  foreignCompanyId = foreign.id;

  const user = await prisma.user.create({
    data: {
      email: `idor-emp-${STAMP}@test.local`,
      passwordHash: 'h',
      name: 'Менеджер',
      role: 'manager',
      companyId: ownCompanyId,
    },
  });
  managerId = user.id;

  const ownOrg = await prisma.organization.create({
    data: { name: `Своя орг ${STAMP}`, companyId: ownCompanyId },
  });
  const foreignOrg = await prisma.organization.create({
    data: { name: `Чужая орг ${STAMP}`, companyId: foreignCompanyId },
  });
  ownOrgId = ownOrg.id;
  foreignOrgId = foreignOrg.id;

  await prisma.organizationManager.create({
    data: { organizationId: ownOrgId, userId: managerId, isActive: true },
  });

  const ownStudent = await prisma.student.create({
    data: { name: `Свой сотрудник ${STAMP}`, organizationId: ownOrgId, snils: '111-222-333 44' },
  });
  const foreignStudent = await prisma.student.create({
    data: { name: `Чужой сотрудник ${STAMP}`, organizationId: foreignOrgId },
  });
  ownStudentId = ownStudent.id;
  foreignStudentId = foreignStudent.id;
});

afterAll(async () => {
  delete process.env.FEATURE_PII_ACCESS_LOG;
  await prisma.piiAccessEvent.deleteMany({ where: { userId: managerId } });
  await prisma.student.deleteMany({ where: { id: { in: [ownStudentId, foreignStudentId] } } });
  await prisma.organizationManager.deleteMany({ where: { userId: managerId } });
  await prisma.organization.deleteMany({ where: { id: { in: [ownOrgId, foreignOrgId] } } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.company.deleteMany({ where: { id: { in: [ownCompanyId, foreignCompanyId] } } });
  await prisma.$disconnect();
});

describe('У-97: сотрудник ищется вместе со своей организацией (живой Postgres)', () => {
  it('своего сотрудника менеджер открывает', async () => {
    const res = await getOrgCardEmployee(prisma, manager([ownOrgId]), {
      orgId: ownOrgId,
      studentId: ownStudentId,
    });
    expect(res?.id).toBe(ownStudentId);
    expect(res?.snils).toBe('111-222-333 44');
  });

  it('чужой studentId в СВОЁМ адресе не открывается', async () => {
    // Самая частая попытка обхода: адрес свой, идентификатор чужой.
    const res = await getOrgCardEmployee(prisma, manager([ownOrgId]), {
      orgId: ownOrgId,
      studentId: foreignStudentId,
    });
    expect(res).toBeNull();
  });

  it('чужая организация в адресе не открывается даже со своим сотрудником', async () => {
    const res = await getOrgCardEmployee(prisma, manager([ownOrgId]), {
      orgId: foreignOrgId,
      studentId: ownStudentId,
    });
    expect(res).toBeNull();
  });

  it('менеджер без закрепления не видит никого', async () => {
    const res = await getOrgCardEmployee(prisma, manager([]), {
      orgId: ownOrgId,
      studentId: ownStudentId,
    });
    expect(res).toBeNull();
  });

  it('успешная выдача попала в журнал доступа к ПДн (§25.7)', async () => {
    await getOrgCardEmployee(prisma, manager([ownOrgId]), {
      orgId: ownOrgId,
      studentId: ownStudentId,
    });
    const events = await prisma.piiAccessEvent.findMany({
      where: { userId: managerId, action: 'view' },
      select: { context: true },
    });
    expect(events.some((e) => e.context === 'org_card_employee_view')).toBe(true);
  });
});
