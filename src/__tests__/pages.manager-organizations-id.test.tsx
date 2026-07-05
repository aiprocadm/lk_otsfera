// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerForOrg } = vi.hoisted(() => ({ requireManagerForOrg: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerForOrg }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getOrganizationCard } = vi.hoisted(() => ({ getOrganizationCard: vi.fn() }));
vi.mock('@/lib/services/manager/organizationCard', () => ({ getOrganizationCard }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
vi.mock('next/navigation', () => nav);

vi.mock('@/components/manager/org-card-tabs', () => ({
  OrgCardTabs: (props: { card: unknown; activeTab: string }) =>
    React.createElement('div', { 'data-testid': 'org-card-tabs' }, props.activeTab, JSON.stringify(props.card)),
  ORG_CARD_TABS: [
    { key: 'history', label: 'История' },
    { key: 'orders', label: 'Заявки' },
    { key: 'documents', label: 'Документы' },
    { key: 'payments', label: 'Оплаты' },
    { key: 'threads', label: 'Переписка' },
    { key: 'details', label: 'Реквизиты' }
  ]
}));

import ManagerOrgDetailPage from '@/app/manager/organizations/[id]/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'member' as const, companyId: 'c1' };
const CARD = { id: 'org-1', name: 'Org' };

describe('ManagerOrgDetailPage', () => {
  beforeEach(() => {
    requireManagerForOrg.mockReset();
    getOrganizationCard.mockReset();
    nav.notFound.mockClear();
  });

  it('calls notFound() when getOrganizationCard returns null', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(null);

    await expect(
      renderServerComponent(
        ManagerOrgDetailPage({
          params: Promise.resolve({ id: 'missing' }),
          searchParams: Promise.resolve({})
        })
      )
    ).rejects.toThrow('NOT_FOUND');
  });

  it('defaults to the "history" tab when no ?tab= is present', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({})
      })
    );

    expect(requireManagerForOrg).toHaveBeenCalledWith('org-1');
    expect(getOrganizationCard).toHaveBeenCalledWith({}, SESSION, 'org-1');
    expect(container.textContent).toContain('history');
  });

  it('uses a recognized ?tab= value verbatim', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'payments' })
      })
    );

    expect(container.textContent).toContain('payments');
  });

  it('falls back to "history" for an unrecognized ?tab= value', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: 'bogus' })
      })
    );

    expect(container.textContent).toContain('history');
  });

  it('falls back to "history" when ?tab= is a string[] (not typeof string)', async () => {
    requireManagerForOrg.mockResolvedValue(SESSION);
    getOrganizationCard.mockResolvedValue(CARD);

    const { container } = await renderServerComponent(
      ManagerOrgDetailPage({
        params: Promise.resolve({ id: 'org-1' }),
        searchParams: Promise.resolve({ tab: ['payments', 'orders'] })
      })
    );

    expect(container.textContent).toContain('history');
  });
});
