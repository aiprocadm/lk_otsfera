import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { transferOrganizationAsLeader } from '@/lib/services/manager/leaderTeam';
import { getLeaderTeamBoard } from '@/lib/services/leader/teamBoard';

/**
 * `У-346` (ТЗ 28.10.2026, макет 2): руководитель переводит организацию другому
 * менеджеру. Открытые заказы прежнего менеджера уходят новому, закрытые и чужие
 * остаются; граница — компания руководителя (C8).
 */

let prisma: PrismaClient;
const STAMP = Date.now();
let companyA: string, companyB: string;
let leader: string, m1: string, m2: string, m3: string, foreignManager: string, deactivated: string;
let org: string, foreignOrg: string, freeOrg: string;
let openM1: string, doneM1: string, openM3: string;

const session = (): SessionPayload =>
  ({ sub: leader, role: 'leader', companyId: companyA }) as unknown as SessionPayload;

async function user(role: 'manager' | 'leader', companyId: string, tag: string, isActive = true) {
  return (
    await prisma.user.create({
      data: {
        email: `ldrTr-${tag}-${STAMP}@x.local`,
        name: `ldrTr ${tag}`,
        role,
        companyId,
        isActive,
      },
    })
  ).id;
}

beforeAll(async () => {
  prisma = new PrismaClient();
  companyA = (await prisma.company.create({ data: { name: `ldrTr-A-${STAMP}` } })).id;
  companyB = (await prisma.company.create({ data: { name: `ldrTr-B-${STAMP}` } })).id;
  leader = await user('leader', companyA, 'leader');
  m1 = await user('manager', companyA, 'm1');
  m2 = await user('manager', companyA, 'm2');
  m3 = await user('manager', companyA, 'm3');
  deactivated = await user('manager', companyA, 'off', false);
  foreignManager = await user('manager', companyB, 'foreign');
  org = (
    await prisma.organization.create({ data: { name: `ldrTr-org-${STAMP}`, companyId: companyA } })
  ).id;
  freeOrg = (
    await prisma.organization.create({ data: { name: `ldrTr-free-${STAMP}`, companyId: companyA } })
  ).id;
  foreignOrg = (
    await prisma.organization.create({
      data: { name: `ldrTr-foreign-${STAMP}`, companyId: companyB },
    })
  ).id;
  await prisma.organizationManager.create({ data: { organizationId: org, userId: m1 } });
  await prisma.organizationManager.create({
    data: { organizationId: foreignOrg, userId: foreignManager },
  });
  const order = async (
    managerId: string,
    executionStatus: 'in_progress' | 'completed',
    tag: string
  ) =>
    (
      await prisma.order.create({
        data: {
          title: `ldrTr-${tag}-${STAMP}`,
          companyId: companyA,
          organizationId: org,
          managerId,
          executionStatus,
          totalAmount: 1000,
          paidAmount: 400,
        },
      })
    ).id;
  openM1 = await order(m1, 'in_progress', 'openM1');
  doneM1 = await order(m1, 'completed', 'doneM1');
  openM3 = await order(m3, 'in_progress', 'openM3');
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: leader } });
  await prisma.order.deleteMany({ where: { companyId: { in: [companyA, companyB] } } });
  await prisma.organizationManager.deleteMany({
    where: { organizationId: { in: [org, freeOrg, foreignOrg] } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: [org, freeOrg, foreignOrg] } } });
  await prisma.user.deleteMany({ where: { email: { contains: `-${STAMP}@x.local` } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyA, companyB] } } });
  await prisma.$disconnect();
});

describe('«Команда» руководителя: доска (У-346)', () => {
  it('у менеджера — его организации со статистикой; организация без менеджера — отдельно', async () => {
    const board = await getLeaderTeamBoard(prisma, session());
    const one = board.managers.find((m) => m.id === m1)!;
    expect(one.orgs).toEqual([
      expect.objectContaining({
        organizationId: org,
        activeOrders: 2,
        inWork: '2000.00',
        paid: '800.00',
        overdue: 0,
      }),
    ]);
    expect(board.unassigned.rows.map((r) => r.id)).toContain(freeOrg);
    expect(board.unassigned.rows.map((r) => r.id)).not.toContain(org);
    // чужая компания на доску не попадает
    expect(board.managers.map((m) => m.id)).not.toContain(foreignManager);
    expect(board.unassigned.rows.map((r) => r.id)).not.toContain(foreignOrg);
  });
});

describe('перевод организации другому менеджеру (У-346)', () => {
  it('отказы: чужая организация, чужой/отключённый менеджер, руководитель, тот же менеджер', async () => {
    const t = (organizationId: string, fromUserId: string, toUserId: string) =>
      transferOrganizationAsLeader(prisma, session(), { organizationId, fromUserId, toUserId });
    expect(await t(foreignOrg, foreignManager, m2)).toEqual({ ok: false, error: 'forbidden_org' });
    expect(await t(org, m1, foreignManager)).toEqual({
      ok: false,
      error: 'transfer_target_invalid',
    });
    expect(await t(org, m1, deactivated)).toEqual({ ok: false, error: 'transfer_target_invalid' });
    expect(await t(org, m1, leader)).toEqual({ ok: false, error: 'transfer_target_invalid' });
    expect(await t(org, m1, `nope-${STAMP}`)).toEqual({
      ok: false,
      error: 'transfer_target_invalid',
    });
    expect(await t(org, m1, m1)).toEqual({ ok: false, error: 'transfer_same_manager' });
    expect(await t(org, m3, m2)).toEqual({ ok: false, error: 'transfer_not_assigned' });
    // ни один отказ ничего не поменял
    const a = await prisma.organizationManager.findMany({ where: { organizationId: org } });
    expect(a.map((x) => [x.userId, x.isActive])).toEqual([[m1, true]]);
  });

  it('m1 → m2: закрепление переехало, открытые заказы m1 — у m2, закрытые и чужие — на месте', async () => {
    const res = await transferOrganizationAsLeader(prisma, session(), {
      organizationId: org,
      fromUserId: m1,
      toUserId: m2,
    });
    expect(res).toEqual({ ok: true, ordersMoved: 1 });

    const rows = await prisma.organizationManager.findMany({
      where: { organizationId: org },
      select: { userId: true, isActive: true, assignedBy: true },
    });
    expect(rows.find((r) => r.userId === m1)?.isActive).toBe(false);
    expect(rows.find((r) => r.userId === m2)).toEqual({
      userId: m2,
      isActive: true,
      assignedBy: leader,
    });

    const managerOf = async (id: string) =>
      (await prisma.order.findUnique({ where: { id }, select: { managerId: true } }))?.managerId;
    expect(await managerOf(openM1)).toBe(m2);
    expect(await managerOf(doneM1)).toBe(m1);
    expect(await managerOf(openM3)).toBe(m3);

    const audit = await prisma.auditLog.findFirst({
      where: { userId: leader, action: 'organization_transferred', entityId: org },
      select: { meta: true },
    });
    expect((audit?.meta as { after?: unknown } | null)?.after).toEqual({
      fromUserId: m1,
      toUserId: m2,
      ordersMoved: 1,
    });
  });

  it('обратно m2 → m1: прежнее закрепление возвращается в работу, а не дублируется', async () => {
    const res = await transferOrganizationAsLeader(prisma, session(), {
      organizationId: org,
      fromUserId: m2,
      toUserId: m1,
    });
    expect(res).toEqual({ ok: true, ordersMoved: 1 });
    const rows = await prisma.organizationManager.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.userId === m1)).toMatchObject({
      isActive: true,
      deactivatedAt: null,
    });
  });
});
