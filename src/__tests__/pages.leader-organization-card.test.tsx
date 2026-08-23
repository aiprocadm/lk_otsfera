// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const { getFieldsForEntity } = vi.hoisted(() => ({ getFieldsForEntity: vi.fn() }));
vi.mock('@/lib/services/customFields', () => ({ getFieldsForEntity }));

const { getAutoCreatedFrom1C } = vi.hoisted(() => ({ getAutoCreatedFrom1C: vi.fn() }));
vi.mock('@/lib/services/organization/autoCreated', () => ({ getAutoCreatedFrom1C }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(() => false) }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: { activeTab: string; tabs: Array<{ key: string }> }) =>
    React.createElement(
      'div',
      { 'data-testid': 'org-card', 'data-active': props.activeTab },
      props.tabs.map((t) => t.key).join(',')
    ),
}));
vi.mock('@/components/students/add-student-dialog', () => ({
  AddStudentDialog: () => React.createElement('div', { 'data-testid': 'add-student' }),
}));
vi.mock('@/components/custom-fields/entity-custom-fields', () => ({
  EntityCustomFields: () => React.createElement('div', { 'data-testid': 'custom-fields' }),
}));
vi.mock('@/components/organization/auto-created-badge', () => ({
  AutoCreatedBadge: () => React.createElement('div', { 'data-testid': 'auto-created' }),
}));

import LeaderOrgDetailPage from '@/app/leader/organizations/[id]/page';

const SESSION = { sub: 'leader-1', role: 'leader' as const, companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManagerLeader.mockResolvedValue(SESSION);
  getOrganizationCard.mockResolvedValue({ id: 'org-1', name: 'ООО «Ромашка»' });
  getFieldsForEntity.mockResolvedValue([]);
  getAutoCreatedFrom1C.mockResolvedValue(null);
  isFeatureEnabled.mockReturnValue(false);
});

/**
 * `У-101`: у руководителя своя карточка организации. До этапа 2 его уводило в
 * `/manager/organizations/[id]` — чужой кабинет с крошками в чужой список.
 */
describe('LeaderOrgDetailPage (У-101)', () => {
  it('гард руководителя и карточка из сервиса со скоупом компании', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(getOrganizationCard).toHaveBeenCalledWith(expect.anything(), SESSION, 'org-1');
    expect(container.querySelector('[data-testid="org-card"]')).not.toBeNull();
  });

  it('крошки ведут в СВОЙ список организаций, а не в кабинет менеджера', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/leader/organizations');
    expect(hrefs.some((h) => h?.startsWith('/manager/'))).toBe(false);
  });

  it('чужая организация — 404, существование не раскрывается', async () => {
    getOrganizationCard.mockResolvedValue(null);
    await expect(
      renderServerComponent(
        LeaderOrgDetailPage({
          params: Promise.resolve({ id: 'foreign' }),
          searchParams: Promise.resolve({}),
        })
      )
    ).rejects.toThrow('NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('состав вкладок — фильтр общего реестра: выключенные флаги вкладок не дают', async () => {
    const { container } = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({}),
      })
    );
    const keys = container.querySelector('[data-testid="org-card"]')!.textContent!.split(',');
    expect(keys).toContain('orders');
    // Флаги выключены — вкладок под флагом нет ни одной.
    for (const gated of ['threads', 'calls', 'requests', 'deals', 'certificates']) {
      expect(keys).not.toContain(gated);
    }
  });

  it('вкладка из адреса подхватывается, мусор откатывается к «Истории»', async () => {
    const ok = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'documents' }),
      })
    );
    expect(ok.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')).toBe(
      'documents'
    );

    const junk = await renderServerComponent(
      LeaderOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'нет-такой' }),
      })
    );
    expect(
      junk.container.querySelector('[data-testid="org-card"]')?.getAttribute('data-active')
    ).toBe('history');
  });
});
