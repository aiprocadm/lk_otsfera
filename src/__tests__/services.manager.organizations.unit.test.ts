/**
 * Unit tests for src/lib/services/manager/organizations.ts
 * Covers: teamMode=ON branch in listOrganizations, скоуп компании в
 * listCompanyOrgOptions.
 *
 * `У-104` (этап 2): деталка `getOrganization` удалена вместе с мёртвым
 * `manager-org-card.tsx` — карточку организации во всех кабинетах отдаёт
 * `services/manager/organizationCard.ts`, её RBAC проверяется там.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, managerOrgScope, canSeeOrganization, isLeaderSameCompany } =
  vi.hoisted(() => ({
    getCompanyTeamVisibility: vi.fn(),
    managerOrgScope: vi.fn(),
    canSeeOrganization: vi.fn(),
    isLeaderSameCompany: vi.fn(() => false),
  }));

vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  managerOrgScope,
  canSeeOrganization,
  // Лидер-инвариант C8 в деталке организации (фикс 30.07.2026): по умолчанию
  // выключен, отдельная проверка ниже включает его точечно.
  isLeaderSameCompany,
}));

import { listOrganizations, listCompanyOrgOptions } from '@/lib/services/manager/organizations';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1',
};

function orgRow(id: string, companyId = 'co-1') {
  return {
    id,
    name: `Org ${id}`,
    companyId,
    _count: { orders: 1, students: 0, users: 2 },
    partner: { id: 'p-1', name: 'Partner' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  managerOrgScope.mockReturnValue({ id: { in: ['org-1'] } });
  canSeeOrganization.mockReturnValue(true);
});

describe('listOrganizations', () => {
  it('calls managerOrgScope and returns all rows', async () => {
    const findMany = vi.fn().mockResolvedValue([orgRow('org-1')]);
    const p = { organization: { findMany } } as never;
    const rows = await listOrganizations(p, SESSION);
    expect(rows).toHaveLength(1);
    expect(managerOrgScope).toHaveBeenCalledWith(SESSION, false);
  });

  it('uses teamModeOverride=true and skips getCompanyTeamVisibility', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    await listOrganizations(p, SESSION, true);
    expect(getCompanyTeamVisibility).not.toHaveBeenCalled();
    expect(managerOrgScope).toHaveBeenCalledWith(SESSION, true);
  });

  it('calls getCompanyTeamVisibility when no override', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    await listOrganizations(p, SESSION);
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith(expect.anything(), 'co-1');
  });

  it('returns empty array when no orgs in scope', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const p = { organization: { findMany } } as never;
    const rows = await listOrganizations(p, SESSION);
    expect(rows).toEqual([]);
  });
});

// A1: справочник для селектов форм переехал со страниц (manager/leader deals,
// manager/leads) в сервис — здесь же проверяется форма запроса.
describe('listCompanyOrgOptions', () => {
  it('фильтрует по компании сессии, узкий select и сортировка по названию', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'org-1', name: 'Org org-1' }]);
    const p = { organization: { findMany } } as never;

    const rows = await listCompanyOrgOptions(p, SESSION);

    expect(rows).toEqual([{ id: 'org-1', name: 'Org org-1' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'co-1' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });

  it('сессия без компании: пустой список и ни одного запроса к БД', async () => {
    const findMany = vi.fn();
    const p = { organization: { findMany } } as never;

    const rows = await listCompanyOrgOptions(p, { ...SESSION, companyId: null });

    expect(rows).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});


/**
 * `У-94`: отбор «без ИНН» — очередь работы после импорта выписки (организации
 * оттуда приходят без ИНН). Отбор обязан **сужать** скоуп роли, а не заменять
 * его: иначе менеджер увидел бы чужих клиентов, лишь бы у них не было ИНН.
 */
describe('listOrganizations — отбор «без ИНН» (У-94)', () => {
  it('фильтр добавляется К скоупу роли, а не вместо него', async () => {
    managerOrgScope.mockReturnValue({ id: { in: ['org-1'] } });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { organization: { findMany } } as never;

    await listOrganizations(prisma, SESSION, false, { withoutInn: true });

    expect(findMany.mock.calls[0]![0].where).toEqual({
      AND: [{ id: { in: ['org-1'] } }, { inn: null }],
    });
  });

  it('без отбора запрос прежний — скоуп роли как был', async () => {
    managerOrgScope.mockReturnValue({ id: { in: ['org-1'] } });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { organization: { findMany } } as never;

    await listOrganizations(prisma, SESSION, false);

    expect(findMany.mock.calls[0]![0].where).toEqual({ id: { in: ['org-1'] } });
  });
});
