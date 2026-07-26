// @vitest-environment jsdom
/**
 * Этап 7 (ФТ-8.1/8.3) — страницы /manager|leader|admin/intake: флаг-гейт до
 * auth, прокидка фильтров/пагинации в сервис, фильтры только у лидера/админа.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager, requireManagerLeader, requireAdmin } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
  requireAdmin: vi.fn()
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader, requireAdmin }));

const { userFindMany } = vi.hoisted(() => ({ userFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findMany: userFindMany } } }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { listIntake } = vi.hoisted(() => ({ listIntake: vi.fn() }));
vi.mock('@/lib/services/intake/list', () => ({ listIntake }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/intake/intake-table', () => ({
  IntakeTable: (props: { items: unknown[]; viewerPrefix: string; currentUserId: string }) =>
    React.createElement('div', { 'data-testid': 'intake-table' }, props.viewerPrefix, `items:${props.items.length}`)
}));
vi.mock('@/components/intake/intake-filters', () => ({
  IntakeFilters: (props: { managers: { name: string }[] }) =>
    React.createElement('div', { 'data-testid': 'intake-filters' }, props.managers.map((m) => m.name).join(','))
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const mod = (await importOriginal()) as Record<string, unknown>;
  return { ...mod, Paginator: () => React.createElement('div', { 'data-testid': 'paginator' }) };
});

import ManagerIntakePage from '@/app/manager/intake/page';
import LeaderIntakePage from '@/app/leader/intake/page';
import AdminIntakePage from '@/app/admin/intake/page';

const SESSION = { sub: 'm1', role: 'manager' as const, companyId: 'c1' };
const OK_RESULT = { ok: true, result: { items: [], total: 0 } };

function sp(params: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(params) };
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  requireManager.mockResolvedValue(SESSION);
  requireManagerLeader.mockResolvedValue({ ...SESSION, managerRole: 'leader' });
  requireAdmin.mockResolvedValue({ sub: 'a1', role: 'admin' });
  listIntake.mockResolvedValue(OK_RESULT);
  listCompanyManagers.mockResolvedValue([{ id: 'm2', name: 'Мария', isActive: true }, { id: 'm3', name: 'Неактивный', isActive: false }]);
  userFindMany.mockResolvedValue([{ id: 'm2', name: 'Мария' }]);
});

describe('ManagerIntakePage', () => {
  it('флаг выключен → notFound до auth', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(ManagerIntakePage(sp()))).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('intake_inbox');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('рендерит таблицу без фильтров; skip → page', async () => {
    const { container } = await renderServerComponent(ManagerIntakePage(sp({ skip: '50' })));
    expect(listIntake).toHaveBeenCalledWith({ user: { findMany: userFindMany } }, SESSION, { page: 2, pageSize: 50 });
    expect(container.querySelector('[data-testid="intake-table"]')?.textContent).toContain('/manager');
    expect(container.querySelector('[data-testid="intake-filters"]')).toBeNull();
    expect(container.textContent).toContain('Входящие в работу');
  });
});

describe('LeaderIntakePage', () => {
  it('фильтры: только активные менеджеры; assignee/unassigned прокидываются', async () => {
    const { container } = await renderServerComponent(LeaderIntakePage(sp({ assignee: 'm2', unassigned: '1' })));
    expect(listIntake).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ managerRole: 'leader' }),
      expect.objectContaining({ assigneeId: 'm2', onlyUnassigned: true })
    );
    const filters = container.querySelector('[data-testid="intake-filters"]');
    expect(filters?.textContent).toBe('Мария');
    expect(container.querySelector('[data-testid="intake-table"]')?.textContent).toContain('/leader');
  });

  it('флаг выключен → notFound', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(LeaderIntakePage(sp()))).rejects.toThrow('NOT_FOUND');
  });

  it('companyId=null → без менеджеров, listCompanyManagers не зовётся', async () => {
    requireManagerLeader.mockResolvedValue({ ...SESSION, companyId: null, managerRole: 'leader' });
    await renderServerComponent(LeaderIntakePage(sp()));
    expect(listCompanyManagers).not.toHaveBeenCalled();
  });
});

describe('AdminIntakePage', () => {
  it('зеркало: staff-список из prisma, viewerPrefix /admin', async () => {
    const { container } = await renderServerComponent(AdminIntakePage(sp()));
    expect(userFindMany).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="intake-table"]')?.textContent).toContain('/admin');
    expect(container.querySelector('[data-testid="intake-filters"]')?.textContent).toBe('Мария');
  });

  it('флаг выключен → notFound', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(AdminIntakePage(sp()))).rejects.toThrow('NOT_FOUND');
  });

  it('сервис вернул forbidden → notFound', async () => {
    listIntake.mockResolvedValue({ ok: false, error: 'forbidden' });
    await expect(renderServerComponent(AdminIntakePage(sp()))).rejects.toThrow('NOT_FOUND');
  });
});
