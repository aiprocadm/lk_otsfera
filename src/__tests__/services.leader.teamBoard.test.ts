import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { rosterMock } = vi.hoisted(() => ({ rosterMock: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers: rosterMock }));

import { getLeaderTeamBoard, UNASSIGNED_LIMIT } from '@/lib/services/leader/teamBoard';

const session = (companyId: string | null = 'c1') =>
  ({ sub: 'l1', role: 'leader', companyId }) as unknown as SessionPayload;

function fakePrisma() {
  const groupBy = vi.fn();
  groupBy
    .mockResolvedValueOnce([
      { organizationId: 'oB', _count: { _all: 2 }, _sum: { totalAmount: '100', paidAmount: null } },
      { organizationId: 'oA', _count: { _all: 2 }, _sum: { totalAmount: '50', paidAmount: '5' } },
      { organizationId: 'oC', _count: { _all: 5 }, _sum: { totalAmount: '10', paidAmount: '1' } },
    ])
    .mockResolvedValueOnce([{ organizationId: 'oA', _count: { _all: 1 } }]);
  return {
    order: { groupBy },
    organization: {
      findMany: vi.fn().mockResolvedValue([{ id: 'oFree', name: 'Ничья', inn: null }]),
      count: vi.fn().mockResolvedValue(1),
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  rosterMock.mockResolvedValue([
    {
      id: 'm1',
      name: 'Анна',
      email: 'a@x',
      isActive: true,
      isLeader: false,
      lastLoginAt: null,
      assignments: [
        { id: 'a-b', organizationId: 'oB', organizationName: 'Бета', isActive: true },
        { id: 'a-a', organizationId: 'oA', organizationName: 'Альфа', isActive: true },
        { id: 'a-c', organizationId: 'oC', organizationName: 'Гамма', isActive: true },
        { id: 'a-z', organizationId: 'oZ', organizationName: 'Зета', isActive: true },
        { id: 'a-old', organizationId: 'oOld', organizationName: 'Снятая', isActive: false },
      ],
    },
  ]);
});

describe('getLeaderTeamBoard (У-346)', () => {
  it('без компании — пустая доска и ни одного запроса (C8)', async () => {
    const prisma = fakePrisma();
    expect(await getLeaderTeamBoard(prisma, session(null))).toEqual({
      managers: [],
      unassigned: { rows: [], total: 0 },
    });
    expect(rosterMock).not.toHaveBeenCalled();
    expect(prisma.order.groupBy).not.toHaveBeenCalled();
  });

  it('организации: снятые скрыты, без заказов — нули, порядок — больше заказов, затем по имени', async () => {
    const prisma = fakePrisma();
    const res = await getLeaderTeamBoard(prisma, session());
    const orgs = res.managers[0]!.orgs;
    expect(orgs.map((o) => o.name)).toEqual(['Гамма', 'Альфа', 'Бета', 'Зета']);
    expect(orgs.find((o) => o.name === 'Бета')).toMatchObject({ inWork: '100.00', paid: '0.00' });
    expect(orgs.find((o) => o.name === 'Альфа')).toMatchObject({ overdue: 1, paid: '5.00' });
    expect(orgs.find((o) => o.name === 'Зета')).toMatchObject({
      activeOrders: 0,
      inWork: '0.00',
      paid: '0.00',
      overdue: 0,
    });
  });

  it('без ответственного — только своя компания, ни одного действующего закрепления, с пределом', async () => {
    const prisma = fakePrisma();
    const res = await getLeaderTeamBoard(prisma, session());
    expect(res.unassigned).toEqual({ rows: [{ id: 'oFree', name: 'Ничья', inn: null }], total: 1 });
    const args = prisma.organization.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ companyId: 'c1', managers: { none: { isActive: true } } });
    expect(args.take).toBe(UNASSIGNED_LIMIT);
    expect(prisma.organization.count.mock.calls[0][0].where).toEqual(args.where);
  });
});
