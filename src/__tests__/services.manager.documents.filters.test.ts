/**
 * `У-253`, `У-258` — фильтры «файлового шкафа» и общее число.
 *
 * Проверяется, что уходит в базу: фильтр, который молча не применился, ничем
 * не отличается от применённого — список просто показывает не то, и человек
 * этого не замечает.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerDocumentScope, canSeeOrder } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  managerDocumentScope: vi.fn(),
  canSeeOrder: vi.fn(),
}));
const { managerOrderLessWhere, canReadOrderLessDocument } = vi.hoisted(() => ({
  managerOrderLessWhere: vi.fn(),
  canReadOrderLessDocument: vi.fn(),
}));
vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerDocumentScope,
  canSeeOrder,
}));
vi.mock('@/lib/auth/documentChannelPolicy', () => ({
  managerOrderLessWhere,
  canReadOrderLessDocument,
}));

import { listDocuments } from '@/lib/services/manager/documents';
import { documentSourceWhere } from '@/lib/documents/source';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

function db(rows: unknown[] = [], total = 0) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(total);
  return {
    prisma: { document: { findMany, count } } as never,
    findMany,
    count,
  };
}

/** Все условия, накопленные в `AND`. */
function filtersOf(findMany: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return findMany.mock.calls[0]![0].where.AND as Record<string, unknown>[];
}

describe('listDocuments — фильтры этапа 8', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompanyTeamVisibility.mockResolvedValue(false);
    managerDocumentScope.mockReturnValue({ companyId: 'co-1' });
  });

  it('без фильтров лишних условий не появляется', async () => {
    const { prisma, findMany } = db();
    await listDocuments(prisma, { session: SESSION });
    const keys = filtersOf(findMany).flatMap((f) => Object.keys(f));
    expect(keys).not.toContain('direction');
    expect(keys).not.toContain('status');
    expect(keys).not.toContain('createdAt');
  });

  it('направление и состояние уходят в выборку как есть', async () => {
    const { prisma, findMany } = db();
    await listDocuments(prisma, { session: SESSION, direction: 'incoming', status: 'sent' });
    expect(filtersOf(findMany)).toEqual(
      expect.arrayContaining([{ direction: 'incoming' }, { status: 'sent' }])
    );
  });

  it('год превращается в границы года, а не в сравнение дат', async () => {
    // Иначе документ, созданный 31 декабря вечером, в выборку не попадёт.
    const { prisma, findMany } = db();
    await listDocuments(prisma, { session: SESSION, year: 2026 });
    expect(filtersOf(findMany)).toEqual(
      expect.arrayContaining([
        {
          createdAt: {
            gte: new Date(Date.UTC(2026, 0, 1)),
            lt: new Date(Date.UTC(2027, 0, 1)),
          },
        },
      ])
    );
  });

  it('источник берётся из общего реестра, а не пишется здесь заново', async () => {
    const { prisma, findMany } = db();
    await listDocuments(prisma, { session: SESSION, source: 'one_c' });
    expect(filtersOf(findMany)).toEqual(expect.arrayContaining([documentSourceWhere('one_c')]));
  });

  it('общее число считается по ТОМУ ЖЕ условию, что и страница', async () => {
    // Разные условия у списка и счётчика — это «показано 50 из 12».
    const { prisma, findMany, count } = db([], 340);
    const res = await listDocuments(prisma, { session: SESSION, type: 'invoice' });
    expect(res.total).toBe(340);
    expect(count.mock.calls[0]![0].where).toEqual(findMany.mock.calls[0]![0].where);
  });

  it('фильтры складываются, а не заменяют друг друга', async () => {
    const { prisma, findMany } = db();
    await listDocuments(prisma, {
      session: SESSION,
      year: 2026,
      direction: 'outgoing',
      status: 'issued',
      source: 'staff',
      type: 'act',
    });
    // Скоуп плюс пять фильтров — шесть условий.
    expect(filtersOf(findMany)).toHaveLength(6);
  });
});
