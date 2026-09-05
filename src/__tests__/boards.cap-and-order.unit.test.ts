import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getFunnelBoard, BOARD_CAP as FUNNEL_CAP } from '@/lib/services/funnel/board';
import {
  listTaskBoard,
  getTaskFormOptions,
  BOARD_CAP as TASK_CAP,
  FORM_ORGANIZATIONS_CAP,
  FORM_ORDERS_CAP,
} from '@/lib/services/tasks/board';

/**
 * `Р-27` (В-3): доски воронки и задач режутся по `BOARD_CAP`, открытые
 * записи идут первыми (`status asc` — порядок enum), а рядом отдаётся честный
 * `count` по тому же `where`. Справочники формы задачи — 200 организаций по
 * последней активности и 100 последних заявок, тоже со счётчиками.
 * Доска сделок покрыта в `services.deals.board.test` (блок Р-27).
 */

const STAFF = {
  sub: 'u-mgr',
  role: 'manager',
  companyId: 'co-A',
  managedOrgIds: [],
} as unknown as SessionPayload;

const CLIENT = { sub: 'u-p', role: 'partner', companyId: 'co-A' } as unknown as SessionPayload;

describe('getFunnelBoard (Р-27)', () => {
  function makePrisma(leads: unknown[], total: number) {
    const findMany = vi.fn().mockResolvedValue(leads);
    const count = vi.fn().mockResolvedValue(total);
    const prisma = {
      funnelStage: { findMany: vi.fn().mockResolvedValue([]) },
      lead: { findMany, count },
    } as unknown as PrismaClient;
    return { prisma, findMany, count };
  }

  it('живые первыми: orderBy [status asc, createdAt desc], take BOARD_CAP', async () => {
    const { prisma, findMany } = makePrisma([], 0);
    await getFunnelBoard(prisma, STAFF);
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'desc' }]);
    expect(args.take).toBe(FUNNEL_CAP);
    expect(FUNNEL_CAP).toBe(500);
  });

  it('count идёт по тому же where; shown = длина выборки, total = count', async () => {
    const leads = [
      {
        id: 'l1',
        clientCompanyName: 'A',
        subject: 's',
        estimatedAmount: null,
        status: 'new',
        funnelStageId: null,
        createdAt: new Date(),
        organization: null,
        assignedManager: null,
      },
    ];
    const { prisma, findMany, count } = makePrisma(leads, 999);
    const board = await getFunnelBoard(prisma, STAFF);
    expect(count.mock.calls[0]![0].where).toEqual(findMany.mock.calls[0]![0].where);
    expect(board.shown).toBe(1);
    expect(board.total).toBe(999);
  });

  it('клиентская роль → пустая доска с нулями, без запросов', async () => {
    const { prisma, findMany, count } = makePrisma([], 0);
    const board = await getFunnelBoard(prisma, CLIENT);
    expect(board).toEqual({ stages: [], columns: [], shown: 0, total: 0 });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });
});

describe('listTaskBoard (Р-27)', () => {
  function makePrisma(tasks: unknown[], total: number) {
    const findMany = vi.fn().mockResolvedValue(tasks);
    const count = vi.fn().mockResolvedValue(total);
    const prisma = {
      taskColumn: { findMany: vi.fn().mockResolvedValue([]) },
      task: { findMany, count },
    } as unknown as PrismaClient;
    return { prisma, findMany, count };
  }

  it('открытые первыми: orderBy [status asc, createdAt desc], take BOARD_CAP', async () => {
    const { prisma, findMany } = makePrisma([], 0);
    await listTaskBoard(prisma, STAFF);
    const args = findMany.mock.calls[0]![0];
    expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'desc' }]);
    expect(args.take).toBe(TASK_CAP);
    expect(TASK_CAP).toBe(500);
  });

  it('count идёт по тому же where (с фильтрами); shown/total честные', async () => {
    const { prisma, findMany, count } = makePrisma([], 42);
    const board = await listTaskBoard(prisma, STAFF, { scope: 'mine', overdue: true });
    const where = findMany.mock.calls[0]![0].where;
    expect(count.mock.calls[0]![0].where).toEqual(where);
    // фильтры реально попали в where (а count их не потерял)
    expect(where.AND[0]).toEqual({ companyId: 'co-A' });
    expect(where.AND).toHaveLength(3);
    expect(board.shown).toBe(0);
    expect(board.total).toBe(42);
  });
});

describe('getTaskFormOptions (Р-27)', () => {
  function makePrisma(opts: {
    orgs?: unknown[];
    orders?: unknown[];
    orgsTotal?: number;
    ordersTotal?: number;
  }) {
    const orgFindMany = vi.fn().mockResolvedValue(opts.orgs ?? []);
    const orderFindMany = vi.fn().mockResolvedValue(opts.orders ?? []);
    const orgCount = vi.fn().mockResolvedValue(opts.orgsTotal ?? 0);
    const orderCount = vi.fn().mockResolvedValue(opts.ordersTotal ?? 0);
    const prisma = {
      user: { findMany: vi.fn().mockResolvedValue([]) },
      organization: { findMany: orgFindMany, count: orgCount },
      order: { findMany: orderFindMany, count: orderCount },
    } as unknown as PrismaClient;
    return { prisma, orgFindMany, orderFindMany, orgCount, orderCount };
  }

  it('организации — по последней активности (updatedAt desc), take 200; заявки — createdAt desc, take 100', async () => {
    const { prisma, orgFindMany, orderFindMany } = makePrisma({});
    await getTaskFormOptions(prisma, STAFF);
    expect(orgFindMany.mock.calls[0]![0].orderBy).toEqual({ updatedAt: 'desc' });
    expect(orgFindMany.mock.calls[0]![0].take).toBe(FORM_ORGANIZATIONS_CAP);
    expect(FORM_ORGANIZATIONS_CAP).toBe(200);
    expect(orderFindMany.mock.calls[0]![0].orderBy).toEqual({ createdAt: 'desc' });
    expect(orderFindMany.mock.calls[0]![0].take).toBe(FORM_ORDERS_CAP);
    expect(FORM_ORDERS_CAP).toBe(100);
  });

  it('счётчики — count по той же компании; отдаются рядом со списками', async () => {
    const { prisma, orgCount, orderCount } = makePrisma({
      orgs: [{ id: 'o1', name: 'Орг' }],
      orders: [{ id: 'r1', title: 'Заявка' }],
      orgsTotal: 350,
      ordersTotal: 120,
    });
    const opt = await getTaskFormOptions(prisma, STAFF);
    expect(orgCount).toHaveBeenCalledWith({ where: { companyId: 'co-A' } });
    expect(orderCount).toHaveBeenCalledWith({ where: { companyId: 'co-A' } });
    expect(opt).toEqual({
      users: [],
      organizations: [{ id: 'o1', name: 'Орг' }],
      orders: [{ id: 'r1', title: 'Заявка' }],
      organizationsTotal: 350,
      ordersTotal: 120,
    });
  });
});
