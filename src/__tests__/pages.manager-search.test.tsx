// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { globalSearch } = vi.hoisted(() => ({ globalSearch: vi.fn() }));
vi.mock('@/lib/services/search/globalSearch', () => ({ globalSearch }));

const nav = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  })
}));
vi.mock('next/navigation', () => nav);

const { resultsSpy } = vi.hoisted(() => ({ resultsSpy: vi.fn() }));
vi.mock('@/components/search/search-results', () => ({
  SearchResults: (props: Record<string, unknown>) => {
    resultsSpy(props);
    return React.createElement('div', { 'data-testid': 'search-results' });
  }
}));

import ManagerSearchPage from '@/app/manager/search/page';

const SESSION = { sub: 'm1', role: 'manager' as const, companyId: 'c1' };

function pageProps(q?: string) {
  return { searchParams: Promise.resolve(q === undefined ? {} : { q }) };
}

describe('ManagerSearchPage', () => {
  beforeEach(() => {
    requireManager.mockReset().mockResolvedValue(SESSION);
    isFeatureEnabled.mockReset().mockReturnValue(true);
    globalSearch.mockReset();
    nav.notFound.mockClear();
    resultsSpy.mockClear();
  });

  it('флаг global_search off → notFound() до auth', async () => {
    isFeatureEnabled.mockReturnValue(false);
    await expect(renderServerComponent(ManagerSearchPage(pageProps()))).rejects.toThrow('NOT_FOUND');
    expect(isFeatureEnabled).toHaveBeenCalledWith('global_search');
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('без q — форма без похода в сервис', async () => {
    const { container } = await renderServerComponent(ManagerSearchPage(pageProps()));
    expect(globalSearch).not.toHaveBeenCalled();
    expect(container.querySelector('form[action="/manager/search"]')).not.toBeNull();
    expect(container.textContent).toContain('Поиск');
    expect(container.textContent).not.toContain('минимум 2 символа');
  });

  it('q из одного символа — подсказка, сервис не зовётся', async () => {
    const { container } = await renderServerComponent(ManagerSearchPage(pageProps('я')));
    expect(globalSearch).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Введите минимум 2 символа');
  });

  it('валидный q → сервис вызван, выдача отрисована', async () => {
    const groups = [{ key: 'orders', labelRu: 'Заказы', hits: [], limited: false }];
    globalSearch.mockResolvedValue({ ok: true, query: 'ромашка', groups });
    const { container } = await renderServerComponent(ManagerSearchPage(pageProps('  ромашка  ')));
    expect(globalSearch).toHaveBeenCalledWith({}, SESSION, { q: 'ромашка' });
    expect(container.querySelector('[data-testid="search-results"]')).not.toBeNull();
    expect(resultsSpy).toHaveBeenCalledWith(expect.objectContaining({ groups, query: 'ромашка' }));
  });

  it('too_short от сервиса (defense-in-depth) → подсказка', async () => {
    globalSearch.mockResolvedValue({ ok: false, error: 'too_short' });
    const { container } = await renderServerComponent(ManagerSearchPage(pageProps('яя')));
    expect(container.textContent).toContain('Введите минимум 2 символа');
  });

  it('forbidden от сервиса → «Поиск недоступен»', async () => {
    globalSearch.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(ManagerSearchPage(pageProps('ромашка')));
    expect(container.textContent).toContain('Поиск недоступен');
  });
});
