import { describe, it, expect, vi } from 'vitest';
import { recentEnrollments as orgRecentEnrollments } from '@/lib/services/organization/dashboard';
import { recentEnrollments as partnerRecentEnrollments } from '@/lib/services/partner/dashboard';

function db(rows: unknown[] = []) {
  const findMany = vi.fn().mockResolvedValue(rows);
  return { d: { enrollmentRequest: { findMany } } as never, findMany };
}

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: 'pending',
  createdAt: new Date('2026-01-02T00:00:00.000Z'),
  legacyCourseTitle: null,
  direction: { name: 'Охрана труда' },
  _count: { items: 3 },
  ...over
});

describe('organization/dashboard recentEnrollments (ФТ-2.4)', () => {
  it('where по organizationId, свежие сверху, take=5 по умолчанию', async () => {
    const { d, findMany } = db();
    await orgRecentEnrollments(d, 'o1');
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { organizationId: 'o1' },
      orderBy: { createdAt: 'desc' },
      take: 5
    });
  });

  it('явный take прокидывается', async () => {
    const { d, findMany } = db();
    await orgRecentEnrollments(d, 'o1', 2);
    expect(findMany.mock.calls[0][0].take).toBe(2);
  });

  it('маппинг: directionName из справочника / legacy / «—», studentCount из _count.items', async () => {
    const { d } = db([
      row('R1'),
      row('R2', { direction: null, legacyCourseTitle: 'Старый курс', _count: { items: 1 } }),
      row('R3', { direction: null, _count: { items: 0 }, status: 'approved' })
    ]);
    const res = await orgRecentEnrollments(d, 'o1');
    expect(res).toEqual([
      { id: 'R1', directionName: 'Охрана труда', studentCount: 3, status: 'pending', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'R2', directionName: 'Старый курс', studentCount: 1, status: 'pending', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'R3', directionName: '—', studentCount: 0, status: 'approved', createdAt: new Date('2026-01-02T00:00:00.000Z') }
    ]);
  });
});

describe('partner/dashboard recentEnrollments (ФТ-2.4)', () => {
  it('весь партнёр (scopeOrgIds=[]): where только по partnerId, take=5', async () => {
    const { d, findMany } = db();
    await partnerRecentEnrollments(d, { partnerId: 'p1', scopeOrgIds: [] });
    expect(findMany.mock.calls[0][0].where).toEqual({ partnerId: 'p1' });
    expect(findMany.mock.calls[0][0].take).toBe(5);
    expect(findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });

  it('сужение по организациям: organizationId in scopeOrgIds', async () => {
    const { d, findMany } = db();
    await partnerRecentEnrollments(d, { partnerId: 'p1', scopeOrgIds: ['o1', 'o2'] }, 7);
    expect(findMany.mock.calls[0][0].where).toEqual({
      partnerId: 'p1',
      organizationId: { in: ['o1', 'o2'] }
    });
    expect(findMany.mock.calls[0][0].take).toBe(7);
  });

  it('маппинг тот же, что у организации: справочник / legacy / «—»', async () => {
    // Партнёрская витрина обязана вести себя как организационная, включая
    // заявки старого формата (направление ещё не из справочника) и заявки, где
    // названия нет вовсе — там должен стоять прочерк, а не пустое место.
    const { d } = db([
      row('R1', { _count: { items: 2 }, status: 'in_training' }),
      row('R2', { direction: null, legacyCourseTitle: 'Старый курс', _count: { items: 1 } }),
      row('R3', { direction: null, _count: { items: 0 }, status: 'approved' })
    ]);
    const res = await partnerRecentEnrollments(d, { partnerId: 'p1', scopeOrgIds: [] });
    expect(res).toEqual([
      {
        id: 'R1',
        directionName: 'Охрана труда',
        studentCount: 2,
        status: 'in_training',
        createdAt: new Date('2026-01-02T00:00:00.000Z')
      },
      { id: 'R2', directionName: 'Старый курс', studentCount: 1, status: 'pending', createdAt: new Date('2026-01-02T00:00:00.000Z') },
      { id: 'R3', directionName: '—', studentCount: 0, status: 'approved', createdAt: new Date('2026-01-02T00:00:00.000Z') }
    ]);
  });
});
