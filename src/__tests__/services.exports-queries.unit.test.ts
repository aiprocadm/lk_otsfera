import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 9 PR-3 (ФТ-12.1/12.2): выборки под выгрузки — те же фильтры и скоуп, что
 * у экранов, но одной страницей до лимита и с `total` для хвоста.
 */

const { getCompanyTeamVisibility, managerOrderScope } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerOrderScope: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrderScope,
  canSeeOrder: vi.fn(),
  isLeaderSameCompany: vi.fn(),
}));

import { listOrdersForExport, ORDERS_EXPORT_LIMIT } from '@/lib/services/manager/orders';
import { listOrgPaymentsForExport } from '@/lib/services/organization/finance';
import {
  listOrgStudentsForExport,
  updateOrgStudentPosition,
} from '@/lib/services/organization/students';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrderScope.mockReturnValue({ scope: true });
});

describe('listOrdersForExport', () => {
  function fakePrisma(rows: unknown[] = [], total = 0) {
    const findMany = vi.fn().mockResolvedValue(rows);
    const count = vi.fn().mockResolvedValue(total);
    return { prisma: { order: { findMany, count } } as never, findMany, count };
  }

  it('без cursor, одной страницей до лимита, с total', async () => {
    const { prisma, findMany, count } = fakePrisma([{ id: 'o1' }], 3);
    const res = await listOrdersForExport(prisma, { session: SESSION });

    expect(res).toEqual({ rows: [{ id: 'o1' }], total: 3 });
    const args = findMany.mock.calls[0]![0];
    expect(args.take).toBe(ORDERS_EXPORT_LIMIT);
    expect(args.cursor).toBeUndefined();
    expect(args.orderBy).toEqual({ id: 'desc' });
    // count считает по тому же where, что и выборка
    expect(count.mock.calls[0]![0].where).toEqual(args.where);
  });

  it('фильтры экрана попадают в where поверх RBAC-скоупа', async () => {
    const { prisma, findMany } = fakePrisma();
    await listOrdersForExport(prisma, {
      session: SESSION,
      executionStatus: 'in_progress',
      financialStatus: 'billed',
      organizationId: 'org-1',
      unassigned: true,
      search: 'Ромашка',
    });

    const filters = findMany.mock.calls[0]![0].where.AND;
    expect(filters[0]).toEqual({ scope: true });
    expect(filters).toContainEqual({ executionStatus: 'in_progress' });
    expect(filters).toContainEqual({ financialStatus: 'billed' });
    expect(filters).toContainEqual({ organizationId: 'org-1' });
    expect(filters).toContainEqual({ managerId: null });
    expect(filters).toContainEqual({
      OR: [
        { title: { contains: 'Ромашка', mode: 'insensitive' } },
        { orderNumber: { contains: 'Ромашка', mode: 'insensitive' } },
      ],
    });
  });

  it('teamModeOverride лидера не спрашивает живой toggle', async () => {
    const { prisma } = fakePrisma();
    await listOrdersForExport(prisma, { session: SESSION, teamModeOverride: true });
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('без override режим команды читается из компании', async () => {
    getCompanyTeamVisibility.mockResolvedValue(true);
    const { prisma } = fakePrisma();
    await listOrdersForExport(prisma, { session: SESSION });
    expect(managerOrderScope).toHaveBeenCalledWith(SESSION, true);
  });
});

describe('listOrgPaymentsForExport', () => {
  it('леджер до лимита + count по той же организации', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(7);
    const prisma = { payment: { findMany, count } } as never;

    const res = await listOrgPaymentsForExport(prisma, { organizationId: 'org-1', limit: 500 });
    expect(res).toEqual({ rows: [], total: 7 });
    expect(findMany.mock.calls[0]![0].take).toBe(500);
    expect(findMany.mock.calls[0]![0].where).toEqual({ organizationId: 'org-1' });
    expect(count.mock.calls[0]![0]).toEqual({ where: { organizationId: 'org-1' } });
  });
});

describe('listOrgStudentsForExport', () => {
  function fakePrisma(students: unknown[], counts: unknown[] = [], total = 0) {
    const findMany = vi.fn().mockResolvedValue(students);
    const count = vi.fn().mockResolvedValue(total);
    const groupBy = vi.fn().mockResolvedValue(counts);
    return {
      prisma: { student: { findMany, count }, certificate: { groupBy } } as never,
      findMany,
      groupBy,
    };
  }

  const S1 = {
    id: 's1',
    name: 'Иванов',
    email: 'i@x.ru',
    position: 'Инженер',
    externalStudentId: null,
    createdAt: new Date('2026-01-01'),
  };

  it('считает действующие удостоверения: бессрочные и не истёкшие', async () => {
    const { prisma, groupBy } = fakePrisma([S1], [{ studentId: 's1', _count: { _all: 4 } }], 1);
    const now = new Date('2026-03-15T18:00:00Z');

    const res = await listOrgStudentsForExport(prisma, {
      organizationId: 'org-1',
      limit: 100,
      now,
    });

    expect(res.rows[0]).toMatchObject({ id: 's1', position: 'Инженер', activeCertificates: 4 });
    expect(res.total).toBe(1);
    const where = groupBy.mock.calls[0]![0].where;
    expect(where.studentId).toEqual({ in: ['s1'] });
    // граница — начало текущего дня, как у certificateStatus
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    expect(where.OR).toEqual([{ validUntil: null }, { validUntil: { gte: startOfToday } }]);
  });

  it('сотрудник без удостоверений — 0, без второго запроса при пустой выдаче', async () => {
    const { prisma, groupBy } = fakePrisma([S1], [], 1);
    const res = await listOrgStudentsForExport(prisma, { organizationId: 'org-1', limit: 100 });
    expect(res.rows[0]!.activeCertificates).toBe(0);

    const empty = fakePrisma([], [], 0);
    const res2 = await listOrgStudentsForExport(empty.prisma, {
      organizationId: 'org-1',
      limit: 100,
    });
    expect(res2.rows).toEqual([]);
    expect(empty.groupBy).not.toHaveBeenCalled();
    expect(groupBy).toHaveBeenCalledTimes(1);
  });

  it('поиск экрана переиспользуется', async () => {
    const { prisma, findMany } = fakePrisma([], [], 0);
    await listOrgStudentsForExport(prisma, {
      organizationId: 'org-1',
      search: 'Иван',
      limit: 100,
    });
    expect(findMany.mock.calls[0]![0].where).toEqual({
      organizationId: 'org-1',
      OR: [
        { name: { contains: 'Иван', mode: 'insensitive' } },
        { email: { contains: 'Иван', mode: 'insensitive' } },
      ],
    });
  });
});

describe('updateOrgStudentPosition', () => {
  function fakePrisma(found: unknown) {
    const findFirst = vi.fn().mockResolvedValue(found);
    const update = vi.fn().mockResolvedValue({});
    return { prisma: { student: { findFirst, update } } as never, findFirst, update };
  }

  it('сохраняет обрезанное значение', async () => {
    const { prisma, update } = fakePrisma({ id: 's1' });
    const res = await updateOrgStudentPosition(prisma, {
      organizationId: 'org-1',
      studentId: 's1',
      position: '  Инженер  ',
    });
    expect(res).toEqual({ ok: true, position: 'Инженер' });
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { position: 'Инженер' } });
  });

  it('пустая строка очищает поле (должность необязательна)', async () => {
    const { prisma, update } = fakePrisma({ id: 's1' });
    const res = await updateOrgStudentPosition(prisma, {
      organizationId: 'org-1',
      studentId: 's1',
      position: '   ',
    });
    expect(res).toEqual({ ok: true, position: null });
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { position: null } });
  });

  it('чужой сотрудник — forbidden, без записи', async () => {
    const { prisma, update } = fakePrisma(null);
    const res = await updateOrgStudentPosition(prisma, {
      organizationId: 'org-1',
      studentId: 'foreign',
      position: 'Инженер',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(update).not.toHaveBeenCalled();
  });

  it('слишком длинное значение — validation, до похода в БД', async () => {
    const { prisma, findFirst } = fakePrisma({ id: 's1' });
    const res = await updateOrgStudentPosition(prisma, {
      organizationId: 'org-1',
      studentId: 's1',
      position: 'я'.repeat(201),
    });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
