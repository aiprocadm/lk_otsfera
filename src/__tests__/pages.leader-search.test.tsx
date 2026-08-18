// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import LeaderSearchPage from '@/app/leader/search/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { globalSearch } = vi.hoisted(() => ({ globalSearch: vi.fn() }));
vi.mock('@/lib/services/search/globalSearch', () => ({ globalSearch }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => nav);

const { resultsSpy } = vi.hoisted(() => ({ resultsSpy: vi.fn() }));
vi.mock('@/components/search/search-results', () => ({
  SearchResults: (props: Record<string, unknown>) => {
    resultsSpy(props);
    return React.createElement('div', { 'data-testid': 'search-results' });
  },
}));

const SESSION = {
  sub: 'l1',
  role: 'leader' as const,
  companyId: 'c1',
};

function pageProps(q?: string) {
  return { searchParams: Promise.resolve(q === undefined ? {} : { q }) };
}

describe('LeaderSearchPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset().mockResolvedValue(SESSION);
    isFeatureEnabled.mockReset().mockReturnValue(true);
    globalSearch.mockReset();
    nav.notFound.mockClear();
    resultsSpy.mockClear();
  });

  it('флаг global_search off → notFound() до auth', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(LeaderSearchPage(pageProps()))).rejects.toThrow('NOT_FOUND');
    expect(requireManagerLeader).not.toHaveBeenCalled();
  });

  it('без q — форма на /leader/search без похода в сервис', async () => {
    const { container } = await renderServerComponent(LeaderSearchPage(pageProps()));
    expect(globalSearch).not.toHaveBeenCalled();
    expect(container.querySelector('form[action="/leader/search"]')).not.toBeNull();
  });

  it('q из одного символа — подсказка, сервис не зовётся', async () => {
    const { container } = await renderServerComponent(LeaderSearchPage(pageProps('я')));
    expect(globalSearch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Введите минимум 2 символа');
  });

  it('валидный q → сервис вызван leader-сессией с teamModeOverride, выдача отрисована', async () => {
    globalSearch.mockResolvedValue({ ok: true, query: 'акт', groups: [] });
    const { container } = await renderServerComponent(LeaderSearchPage(pageProps('акт')));
    expect(globalSearch).toHaveBeenCalledWith({}, SESSION, { q: 'акт', teamModeOverride: true });
    expect(container.querySelector('[data-testid="search-results"]')).not.toBeNull();
  });

  it('too_short → подсказка; forbidden → «Поиск недоступен»', async () => {
    globalSearch.mockResolvedValue({ ok: false, error: 'too_short' });
    const first = await renderServerComponent(LeaderSearchPage(pageProps('яя')));
    expect(first.container.textContent).toContain('Введите минимум 2 символа');

    globalSearch.mockResolvedValue({ ok: false, error: 'forbidden' });
    const second = await renderServerComponent(LeaderSearchPage(pageProps('акт')));
    expect(second.container.textContent).toContain('Поиск недоступен');
  });
});
