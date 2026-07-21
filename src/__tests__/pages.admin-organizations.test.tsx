// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { partnerFindMany } = vi.hoisted(() => ({ partnerFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { partner: { findMany: partnerFindMany } }
}));

const { listOrganizations } = vi.hoisted(() => ({ listOrganizations: vi.fn() }));
vi.mock('@/lib/services/admin/organizations', () => ({ listOrganizations }));

// Client-компонент диалога создания — заглушка (SSR-тест страницы его не драйвит).
vi.mock('@/components/admin/create-organization-dialog', () => ({
  CreateOrganizationDialog: () => null
}));

import AdminOrganizationsPage from '@/app/admin/organizations/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

const ORG = {
  id: 'org-1',
  name: 'Организация 1',
  inn: '1234567890',
  partner: { name: 'Партнёр 1' },
  ordersCount: 3,
  organizationUsersCount: 2,
  partnerCommissionRate: null
};

describe('AdminOrganizationsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    partnerFindMany.mockReset();
    listOrganizations.mockReset();
  });

  it('parses q/skip/partnerId/withRateOverride filters and renders rows with a rate-override dot + pluralized count', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({
      rows: [{ ...ORG, partnerCommissionRate: 0.1 }],
      total: 1
    });
    partnerFindMany.mockResolvedValue([{ id: 'p1', name: 'Партнёр 1' }]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({
        searchParams: Promise.resolve({ q: ' test ', partnerId: 'p1', withRateOverride: 'true', skip: '10' })
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listOrganizations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: 'test', partnerId: 'p1', withRateOverride: true, skip: 10, take: 50 })
    );
    expect(container.textContent).toContain('организация');
    expect(container.textContent).toContain('по запросу «test»');
    expect(container.querySelector('span[title="Ставка override задана"]')).not.toBeNull();
  });

  it('renders withRateOverride:false, negative skip clamped to 0, EmptyState when no orgs, and pluralize "организации"/"организаций" branches', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({ rows: [], total: 3 });
    partnerFindMany.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({ searchParams: Promise.resolve({ withRateOverride: 'false', skip: '-5' }) })
    );

    expect(listOrganizations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ withRateOverride: false, skip: 0 })
    );
    expect(container.textContent).toContain('организации');
    expect(container.textContent).toContain('не нашлось');
  });

  it('uses withRateOverride:undefined for any other value, no partner link dot when partnerCommissionRate is null, and falls back inn/partner to "—"/"Без партнёра" (pluralize "организаций" 11-14 exclusion)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({
      rows: [{ ...ORG, inn: null, partner: null }],
      total: 13
    });
    partnerFindMany.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({ searchParams: Promise.resolve({}) })
    );

    expect(listOrganizations).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ withRateOverride: undefined, q: undefined })
    );
    expect(container.textContent).toContain('организаций');
    expect(container.textContent).toContain('Без партнёра');
    expect(container.querySelector('span[title="Ставка override задана"]')).toBeNull();
  });

  it('renders the paginator with both Назад/Вперёд links (all filters set) when in the middle of a result set', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({ rows: [ORG], total: 200 });
    partnerFindMany.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({
        searchParams: Promise.resolve({ skip: '50', q: 'abc', partnerId: 'p9', withRateOverride: 'true' })
      })
    );

    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'Назад' || a.textContent === 'Вперёд'
    );
    expect(links.length).toBe(2);
    // skip=0 is omitted from the querystring by the page's link() helper
    const back = links.find((a) => a.textContent === 'Назад')?.getAttribute('href');
    expect(back).toContain('q=abc');
    expect(back).toContain('partnerId=p9');
    expect(back).toContain('withRateOverride=true');
    expect(back).not.toContain('skip=');
    const forward = links.find((a) => a.textContent === 'Вперёд')?.getAttribute('href');
    expect(forward).toContain('skip=100');
  });

  it('renders the paginator with partnerId/withRateOverride falling back to "" when absent from searchParams', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({ rows: [ORG], total: 200 });
    partnerFindMany.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({ searchParams: Promise.resolve({ skip: '50' }) })
    );

    const forward = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Вперёд');
    expect(forward?.getAttribute('href')).toBe('/admin/organizations?skip=100');
  });

  it('omits the paginator entirely when total <= PAGE_SIZE', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listOrganizations.mockResolvedValue({ rows: [ORG], total: 1 });
    partnerFindMany.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminOrganizationsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).not.toContain('Страница');
  });
});
