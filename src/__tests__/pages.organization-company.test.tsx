// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * `У-100`: «Моя организация» — карточка своей организации в кабинете
 * заказчика. Проверяем состав вкладок (подмножество общего реестра), выбор
 * вкладки адресом и то, что данные грузятся только для открытой вкладки.
 */
const { getOrgPageContext } = vi.hoisted(() => ({ getOrgPageContext: vi.fn() }));
vi.mock('@/lib/auth/orgPageContext', () => ({ getOrgPageContext }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));

const { getOrgRequisites } = vi.hoisted(() => ({ getOrgRequisites: vi.fn() }));
vi.mock('@/lib/services/organization/requisites', () => ({ getOrgRequisites }));

vi.mock('@/server-actions/requisites', () => ({ setOrgRequisitesAction: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/organization/company',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/organization/org-app-shell', () => ({
  OrgAppShell: (p: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'shell' }, p.children),
}));
vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (p: {
    activeTab: string;
    tabs: Array<{ key: string }>;
    employees?: React.ReactNode;
    settings?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'card', 'data-active': p.activeTab },
      p.tabs.map((t) => t.key).join(','),
      p.employees,
      p.settings
    ),
}));
vi.mock('@/components/organization/org-employees-section', () => ({
  OrgEmployeesSection: (p: { total: number }) =>
    React.createElement('div', null, `СОТРУДНИКИ:${p.total}`),
}));
vi.mock('@/components/organization/org-cabinet-access-section', () => ({
  OrgCabinetAccessSection: () => React.createElement('div', null, 'ДОСТУП'),
}));
vi.mock('@/components/requisites/requisites-card', () => ({
  RequisitesCard: () => React.createElement('div', null, 'ФОРМА РЕКВИЗИТОВ'),
}));
vi.mock('@/components/organization/org-requisites-view', () => ({
  OrgRequisitesView: () => React.createElement('div', null, 'РЕКВИЗИТЫ ТОЛЬКО ЧТЕНИЕ'),
}));

import OrganizationCompanyPage from '@/app/organization/company/page';

const CARD = {
  id: 'org-1',
  name: 'ООО «Ромашка»',
  inn: null,
  kpp: null,
  requisites: {
    legalName: null,
    ogrn: null,
    legalAddress: null,
    bankName: null,
    bankAccount: null,
    corrAccount: null,
    bic: null,
    signerName: null,
    signerPosition: null,
    signerBasis: null,
  },
};

function ctx(viewerRole: 'admin' | 'leader' | 'member' = 'admin') {
  return {
    session: { sub: 'u1', role: 'organization', email: 'a@b.c' },
    activeOrgId: 'org-1',
    activeOrgName: 'ООО «Ромашка»',
    memberships: [],
    viewerRole,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  getOrgPageContext.mockResolvedValue(ctx());
  getOrganizationCard.mockResolvedValue(CARD);
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 4, canWrite: true });
  getOrgRequisites.mockResolvedValue({ ok: true, requisites: {} });
});

const render = (sp: Record<string, string> = {}) =>
  renderServerComponent(OrganizationCompanyPage({ searchParams: Promise.resolve(sp) }));

describe('«Моя организация» (У-100)', () => {
  it('вкладки — подмножество общего реестра, а не свой список', async () => {
    const { container } = await render();
    const keys = container.querySelector('[data-testid="card"]')?.textContent ?? '';
    expect(keys).toContain('employees');
    expect(keys).toContain('orders');
    expect(keys).toContain('settings');
    // Внутренние разделы учебного центра заказчику не положены.
    expect(keys).not.toContain('leads');
    expect(keys).not.toContain('payments');
    expect(keys).not.toContain('calls');
  });

  it('вкладка выбирается адресом, неизвестная — падает на «Обзор»', async () => {
    const employees = await render({ tab: 'employees' });
    expect(employees.container.querySelector('[data-testid="card"]')?.getAttribute('data-active')).toBe(
      'employees'
    );

    const bogus = await render({ tab: 'leads' });
    expect(bogus.container.querySelector('[data-testid="card"]')?.getAttribute('data-active')).toBe(
      'overview'
    );
  });

  it('сотрудники и реквизиты грузятся только на своих вкладках', async () => {
    await render();
    expect(listOrgCardEmployees).not.toHaveBeenCalled();
    expect(getOrgRequisites).not.toHaveBeenCalled();

    await render({ tab: 'employees' });
    expect(listOrgCardEmployees).toHaveBeenCalled();

    vi.clearAllMocks();
    isFeatureEnabled.mockReturnValue(true);
    getOrgPageContext.mockResolvedValue(ctx());
    getOrganizationCard.mockResolvedValue(CARD);
    getOrgRequisites.mockResolvedValue({ ok: true, requisites: {} });
    await render({ tab: 'settings' });
    expect(getOrgRequisites).toHaveBeenCalled();
  });

  it('участник без прав видит реквизиты, но не форму (право решает роль в организации)', async () => {
    getOrgPageContext.mockResolvedValue(ctx('member'));
    const { container } = await render({ tab: 'settings' });
    expect(container.textContent).toContain('РЕКВИЗИТЫ ТОЛЬКО ЧТЕНИЕ');
    expect(container.textContent).not.toContain('ФОРМА РЕКВИЗИТОВ');
  });

  it('администратор организации получает форму реквизитов', async () => {
    const { container } = await render({ tab: 'settings' });
    expect(container.textContent).toContain('ФОРМА РЕКВИЗИТОВ');
    expect(container.textContent).toContain('ДОСТУП');
  });

  it('чужая организация — «не найдено» (границу держит сервис)', async () => {
    getOrganizationCard.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });

  it('кабинет заказчика выключен флагом — раздела нет', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});
