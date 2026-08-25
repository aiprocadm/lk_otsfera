// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * `У-96`: карточка организации у партнёра берёт состав вкладок из общего
 * реестра. Раньше у него был свой список из пяти ключей, и «Заказы», «Обзор» и
 * «Заявки на обучение» ему не показывались вовсе, а «История» — журнал
 * действий учебного центра — наоборот, показывалась.
 */
const { requirePartner } = vi.hoisted(() => ({ requirePartner: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requirePartner }));

const { canPartnerAccessOrg, isPartnerAdmin } = vi.hoisted(() => ({
  canPartnerAccessOrg: vi.fn(),
  isPartnerAdmin: vi.fn(),
}));
vi.mock('@/lib/auth/policy', () => ({ canPartnerAccessOrg, isPartnerAdmin }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const { listOrgCardEmployees } = vi.hoisted(() => ({ listOrgCardEmployees: vi.fn() }));
vi.mock('@/lib/services/organization/orgCardEmployees', () => ({ listOrgCardEmployees }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (p: {
    activeTab: string;
    tabs: Array<{ key: string }>;
    hrefFor?: (k: string) => string;
    employees?: React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'card', 'data-active': p.activeTab },
      p.tabs.map((t) => `${t.key}=${p.hrefFor ? p.hrefFor(t.key) : '?'}`).join(' '),
      p.employees
    ),
}));
vi.mock('@/components/organization/org-employees-section', () => ({
  OrgEmployeesSection: (p: { total: number }) =>
    React.createElement('div', null, `СОТРУДНИКИ:${p.total}`),
}));

import OrgCardPage from '@/app/partner/portfolio/[orgId]/page';

const CARD = { id: 'org-1', name: 'ООО «Ромашка»', inn: '7707083893' };

beforeEach(() => {
  vi.clearAllMocks();
  requirePartner.mockResolvedValue({ sub: 'p1', role: 'partner', partnerId: 'pt-1' });
  canPartnerAccessOrg.mockResolvedValue(true);
  isPartnerAdmin.mockReturnValue(true);
  isFeatureEnabled.mockReturnValue(true);
  getOrganizationCard.mockResolvedValue(CARD);
  listOrgCardEmployees.mockResolvedValue({ rows: [], total: 3, canWrite: true });
});

const render = (sp: Record<string, string> = {}) =>
  renderServerComponent(
    OrgCardPage({ params: Promise.resolve({ orgId: 'org-1' }), searchParams: Promise.resolve(sp) })
  );

describe('карточка организации у партнёра (У-96)', () => {
  it('вкладки — из общего реестра, а не свой список из пяти ключей', async () => {
    const { container } = await render();
    const keys = container.querySelector('[data-testid="card"]')?.textContent ?? '';
    for (const key of ['overview', 'employees', 'orders', 'documents', 'comments', 'settings']) {
      expect(keys, key).toContain(`${key}=`);
    }
  });

  it('внутренних вкладок учебного центра у партнёра нет', async () => {
    const { container } = await render();
    const keys = container.querySelector('[data-testid="card"]')?.textContent ?? '';
    for (const key of ['payments', 'leads', 'deals', 'calls', 'inbound', 'history']) {
      expect(keys, key).not.toContain(`${key}=`);
    }
  });

  it('«Документы» и «Настройки» ведут на свои страницы, остальное — на вкладку', async () => {
    const { container } = await render();
    const keys = container.querySelector('[data-testid="card"]')?.textContent ?? '';
    expect(keys).toContain('documents=/partner/portfolio/org-1/documents');
    expect(keys).toContain('settings=/partner/portfolio/org-1/settings');
    expect(keys).toContain('orders=/partner/portfolio/org-1?tab=orders');
  });

  it('не администратору партнёра вкладки «Настройки» не дают — страницы у него нет', async () => {
    isPartnerAdmin.mockReturnValue(false);
    const { container } = await render();
    expect(container.querySelector('[data-testid="card"]')?.textContent ?? '').not.toContain(
      'settings='
    );
  });

  it('вкладка по умолчанию — «Обзор», мусор в адресе туда же', async () => {
    const first = await render();
    expect(first.container.querySelector('[data-testid="card"]')?.getAttribute('data-active')).toBe(
      'overview'
    );

    const bogus = await render({ tab: 'leads' });
    expect(bogus.container.querySelector('[data-testid="card"]')?.getAttribute('data-active')).toBe(
      'overview'
    );
  });

  it('сотрудники грузятся только на своей вкладке', async () => {
    await render();
    expect(listOrgCardEmployees).not.toHaveBeenCalled();

    const { container } = await render({ tab: 'employees' });
    expect(listOrgCardEmployees).toHaveBeenCalled();
    expect(container.textContent).toContain('СОТРУДНИКИ:3');
  });

  it('организация вне портфеля — отказ до обращения к карточке', async () => {
    canPartnerAccessOrg.mockResolvedValue(false);
    await expect(render()).rejects.toThrow('REDIRECT:/forbidden');
    expect(getOrganizationCard).not.toHaveBeenCalled();
  });

  it('карточка не отдалась — «не найдено» (границу держит сервис)', async () => {
    getOrganizationCard.mockResolvedValue(null);
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});
