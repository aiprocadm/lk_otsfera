// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminPartnersPage from '@/app/admin/partners/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listPartners } = vi.hoisted(() => ({ listPartners: vi.fn() }));
vi.mock('@/lib/services/admin/partners', () => ({ listPartners }));

vi.mock('@/components/admin/partners-filters', () => ({
  PartnersFilters: (props: { active?: string; filter?: string; q?: string }) =>
    React.createElement('div', { 'data-testid': 'partners-filters' }, JSON.stringify(props)),
}));

vi.mock('@/components/admin/partners-table', () => ({
  PartnersTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'partners-table' }, JSON.stringify(props.rows)),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminPartnersPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listPartners.mockReset();
  });

  it('parses active/filter/q/skip filters and renders the partners table + total', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listPartners.mockResolvedValue({ rows: [{ id: 'p1', name: 'Партнёр' }], total: 1 });

    const { container } = await renderServerComponent(
      AdminPartnersPage({
        searchParams: Promise.resolve({
          active: 'true',
          filter: 'norate',
          q: ' test ',
          skip: '10',
        }),
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listPartners).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ active: true, filter: 'norate', q: 'test', skip: 10, take: 50 })
    );
    expect(container.textContent).toContain('Партнёры');
    expect(container.textContent).toContain('1 всего');
    expect(container.querySelector('a[href="/admin/partners/new"]')).not.toBeNull();
  });

  it('parses active:false and filter values other than "norate" as undefined; negative skip clamps to 0', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listPartners.mockResolvedValue({ rows: [], total: 0 });

    await renderServerComponent(
      AdminPartnersPage({
        searchParams: Promise.resolve({ active: 'false', filter: 'other', skip: '-5' }),
      })
    );

    expect(listPartners).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ active: false, filter: undefined, q: undefined, skip: 0 })
    );
  });

  it('leaves active undefined for any other value and renders the paginator with both links mid-set', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listPartners.mockResolvedValue({ rows: [], total: 200 });

    const { container } = await renderServerComponent(
      AdminPartnersPage({ searchParams: Promise.resolve({ skip: '50', q: 'abc' }) })
    );

    expect(listPartners).toHaveBeenCalledWith({}, expect.objectContaining({ active: undefined }));
    const links = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.textContent === 'Назад' || a.textContent === 'Вперёд'
    );
    expect(links.length).toBe(2);
    const back = links.find((a) => a.textContent === 'Назад')?.getAttribute('href');
    expect(back).toContain('q=abc');
    expect(back).not.toContain('skip=');
    const forward = links.find((a) => a.textContent === 'Вперёд')?.getAttribute('href');
    expect(forward).toContain('skip=100');
  });

  it('renders a bare (no querystring) "Назад" link when it points back to skip=0 and no other filters are set', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listPartners.mockResolvedValue({ rows: [], total: 200 });

    const { container } = await renderServerComponent(
      AdminPartnersPage({ searchParams: Promise.resolve({ skip: '50' }) })
    );

    const back = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Назад');
    expect(back?.getAttribute('href')).toBe('/admin/partners');
  });

  it('omits the paginator when total <= PAGE_SIZE', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listPartners.mockResolvedValue({ rows: [], total: 1 });

    const { container } = await renderServerComponent(
      AdminPartnersPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).not.toContain('Страница');
  });
});
