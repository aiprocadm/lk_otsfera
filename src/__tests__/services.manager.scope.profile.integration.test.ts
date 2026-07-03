import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { listOrders } from '@/lib/services/manager/orders';
import { getManagerFinanceOverview } from '@/lib/services/manager/finance';
import { toSessionAccessProfile } from '@/lib/auth/accessProfile';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * G1 (Трек G1) — profile-driven scope против живого Postgres.
 *
 * Доводит unit-доказательства (auth.accessProfile / auth.managerPolicy.profile /
 * services.manager.finance) до реальных Prisma-выборок:
 *   1. модель AccessProfile создаётся и привязывается к User;
 *   2. профиль `assigned` реально сужает listOrders до закреплённых орг, `all` —
 *      до company-wide (company-floor держится в обоих);
 *   3. capability `see_commission` реально гейтит выдачу комиссии на уровне API.
 *
 * Company A содержит закреплённую орг (orgAssigned) и незакреплённую (orgOther);
 * профилированный менеджер с managedOrgIds=[orgAssigned] должен видеть только
 * заказ orgAssigned при уровне `assigned` и оба при `all`.
 */

let prisma: PrismaClient;
const STAMP = Date.now();

let companyId: string;
let orgAssigned: string, orgOther: string;
let orderAssigned: string, orderOther: string;
let assignedProfileId: string, allSeeCommissionProfileId: string;

function sessionWithProfile(
  accessProfile: SessionPayload['accessProfile'],
  managedOrgIds: string[]
): SessionPayload {
  return {
    sub: `g1-mgr-${STAMP}`,
    role: 'manager',
    companyId,
    managedOrgIds,
    accessProfile
  } as unknown as SessionPayload;
}

beforeAll(async () => {
  prisma = new PrismaClient();

  const company = await prisma.company.create({ data: { name: `g1-co-${STAMP}` } });
  companyId = company.id;

  const oAssigned = await prisma.organization.create({ data: { name: `g1-orgA-${STAMP}`, companyId } });
  orgAssigned = oAssigned.id;
  const oOther = await prisma.organization.create({ data: { name: `g1-orgB-${STAMP}`, companyId } });
  orgOther = oOther.id;

  const ordA = await prisma.order.create({
    data: { title: 'g1 assigned-order', companyId, organizationId: orgAssigned, totalAmount: 100000 }
  });
  orderAssigned = ordA.id;
  const ordB = await prisma.order.create({
    data: { title: 'g1 other-order', companyId, organizationId: orgOther, totalAmount: 200000 }
  });
  orderOther = ordB.id;

  const pAssigned = await prisma.accessProfile.create({
    data: {
      companyId,
      name: `Оператор-${STAMP}`,
      ordersScope: 'assigned',
      organizationsScope: 'assigned',
      threadsScope: 'assigned',
      documentsScope: 'assigned',
      financeScope: 'own',
      leadsScope: 'own',
      tasksScope: 'own',
      capabilities: []
    }
  });
  assignedProfileId = pAssigned.id;

  const pAll = await prisma.accessProfile.create({
    data: {
      companyId,
      name: `Финдиректор-${STAMP}`,
      ordersScope: 'all',
      organizationsScope: 'all',
      threadsScope: 'all',
      documentsScope: 'all',
      financeScope: 'all',
      leadsScope: 'all',
      tasksScope: 'all',
      capabilities: ['see_commission']
    }
  });
  allSeeCommissionProfileId = pAll.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: { in: [orderAssigned, orderOther] } } });
  await prisma.user.deleteMany({ where: { accessProfileId: { in: [assignedProfileId, allSeeCommissionProfileId] } } });
  await prisma.accessProfile.deleteMany({ where: { id: { in: [assignedProfileId, allSeeCommissionProfileId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAssigned, orgOther] } } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

describe('G1 — AccessProfile модель + привязка к User', () => {
  it('профиль создаётся в компании и привязывается к пользователю (User.accessProfile)', async () => {
    const user = await prisma.user.create({
      data: {
        email: `g1-user-${STAMP}@t.local`,
        name: 'G1 Manager',
        role: 'manager',
        companyId,
        accessProfileId: assignedProfileId
      }
    });
    const read = await prisma.user.findUnique({
      where: { id: user.id },
      include: { accessProfile: true }
    });
    expect(read?.accessProfile?.id).toBe(assignedProfileId);
    expect(read?.accessProfile?.ordersScope).toBe('assigned');
    expect(read?.accessProfile?.capabilities).toEqual([]);
  });
});

describe('G1 — профиль реально сужает выборку заказов', () => {
  it('assigned: менеджер видит только заказ закреплённой орги (teamMode override игнорируется)', async () => {
    const row = await prisma.accessProfile.findUniqueOrThrow({ where: { id: assignedProfileId } });
    const session = sessionWithProfile(toSessionAccessProfile(row), [orgAssigned]);
    const { rows } = await listOrders(prisma, { session, teamModeOverride: true });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderAssigned); // positive control
    expect(ids).not.toContain(orderOther); // assigned не пускает к незакреплённой орге
  });

  it('all: менеджер видит все заказы компании (company-wide)', async () => {
    const row = await prisma.accessProfile.findUniqueOrThrow({ where: { id: allSeeCommissionProfileId } });
    const session = sessionWithProfile(toSessionAccessProfile(row), [orgAssigned]);
    const { rows } = await listOrders(prisma, { session, teamModeOverride: false });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(orderAssigned);
    expect(ids).toContain(orderOther);
  });
});

describe('G1 — see_commission гейтит выдачу комиссии на уровне API', () => {
  it('профиль без флага: комиссия скрыта', async () => {
    const row = await prisma.accessProfile.findUniqueOrThrow({ where: { id: assignedProfileId } });
    const session = sessionWithProfile(toSessionAccessProfile(row), [orgAssigned]);
    const overview = await getManagerFinanceOverview(prisma, session, { teamMode: false });
    expect(overview.canSeeCommission).toBe(false);
    expect(overview.sections.every((s) => s.commission === null)).toBe(true);
  });

  it('профиль с флагом: комиссия отдаётся', async () => {
    const row = await prisma.accessProfile.findUniqueOrThrow({ where: { id: allSeeCommissionProfileId } });
    const session = sessionWithProfile(toSessionAccessProfile(row), [orgAssigned]);
    const overview = await getManagerFinanceOverview(prisma, session, { teamMode: false });
    expect(overview.canSeeCommission).toBe(true);
    expect(overview.sections.some((s) => s.commission !== null)).toBe(true);
  });
});
