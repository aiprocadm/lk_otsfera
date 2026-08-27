// @vitest-environment jsdom
/**
 * Страницы «Каталог услуг и цены» (`У-136`, этап 5, PR-1): админ выбирает
 * компанию явно, руководитель пришпилен к своей. Экран презентационный —
 * проверяем, что страницы зовут гард своего кабинета, собирают данные и
 * передают контрактные пропсы; сам экран замокан и печатает пропсы JSON'ом.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCatalogItems } = vi.hoisted(() => ({ listCatalogItems: vi.fn() }));
vi.mock('@/lib/services/admin/catalogItems', () => ({ listCatalogItems }));

const { listCompanyOptions } = vi.hoisted(() => ({ listCompanyOptions: vi.fn() }));
vi.mock('@/lib/services/admin/orders', () => ({ listCompanyOptions }));

const { listDirectionOptions } = vi.hoisted(() => ({ listDirectionOptions: vi.fn() }));
vi.mock('@/lib/services/training/directions', () => ({ listDirectionOptions }));

// Экран замокан: страница проверяется по пропсам, а не по вёрстке экрана.
vi.mock('@/components/settings/price-list-screen', () => ({
  PriceListScreen: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'price-list-screen' }, JSON.stringify(props)),
}));

import AdminPriceListPage from '@/app/admin/settings/catalogs/price-list/page';
import LeaderPriceListPage from '@/app/leader/settings/catalogs/price-list/page';

const ADMIN = { sub: 'a1', role: 'admin' as const };
const LEADER = { sub: 'l1', role: 'leader' as const };

const COMPANIES = [
  { id: 'c1', name: 'Промтехносфера' },
  { id: 'c2', name: 'Вторая' },
];

const ITEM = {
  id: 'i1',
  name: 'Обучение по ОТ',
  code: 'OT-101',
  unit: 'person',
  price: '1500.00',
  vatRate: null,
  vatIncluded: false,
  directionId: null,
  directionName: null,
  description: null,
  isActive: true,
  sortOrder: 0,
};

beforeEach(() => {
  requireSettingsSection
    .mockReset()
    .mockImplementation((_id: string, cabinet: string) =>
      Promise.resolve(cabinet === 'admin' ? ADMIN : LEADER)
    );
  listCatalogItems.mockReset().mockResolvedValue({ ok: true, items: [ITEM] });
  listCompanyOptions.mockReset().mockResolvedValue(COMPANIES);
  listDirectionOptions.mockReset().mockResolvedValue([{ id: 'd1', name: 'Охрана труда' }]);
});

/** Рендерит страницу и возвращает пропсы, дошедшие до экрана. */
async function renderPage(
  page: (a: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>,
  params: Record<string, string> = {}
) {
  const { container } = await renderServerComponent(
    page({ searchParams: Promise.resolve(params) })
  );
  const el = container.querySelector('[data-testid="price-list-screen"]');
  return JSON.parse(el!.textContent!) as Record<string, unknown>;
}

describe('админ: /admin/settings/catalogs/price-list', () => {
  it('гард раздела; без ?company активна первая компания', async () => {
    const props = await renderPage(AdminPriceListPage);

    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.priceList', 'admin');
    expect(props.cabinet).toBe('admin');
    expect(props.hasCompany).toBe(true);
    expect(props.companies).toEqual(COMPANIES);
    expect(props.activeCompanyId).toBe('c1');
    expect(props.items).toEqual([ITEM]);
    expect(props.directions).toEqual([{ id: 'd1', name: 'Охрана труда' }]);
    expect(listCatalogItems).toHaveBeenCalledWith({}, ADMIN, {
      companyId: 'c1',
      q: '',
      includeInactive: false,
    });
  });

  it('?company, ?q и ?inactive прокидываются в сервис и в экран', async () => {
    const props = await renderPage(AdminPriceListPage, { company: 'c2', q: 'ОТ', inactive: '1' });

    expect(listCatalogItems).toHaveBeenCalledWith({}, ADMIN, {
      companyId: 'c2',
      q: 'ОТ',
      includeInactive: true,
    });
    expect(props.activeCompanyId).toBe('c2');
    expect(props.q).toBe('ОТ');
    expect(props.includeInactive).toBe(true);
  });

  it('компаний нет вовсе: каталог не читаем, экран получает пустоту', async () => {
    listCompanyOptions.mockResolvedValue([]);
    const props = await renderPage(AdminPriceListPage);

    expect(listCatalogItems).not.toHaveBeenCalled();
    expect(props.activeCompanyId).toBeNull();
    expect(props.items).toEqual([]);
  });

  it('отказ сервиса не роняет страницу: items пуст', async () => {
    listCatalogItems.mockResolvedValue({ ok: false, error: 'forbidden' });
    const props = await renderPage(AdminPriceListPage);
    expect(props.items).toEqual([]);
  });
});

describe('руководитель: /leader/settings/catalogs/price-list', () => {
  it('без companyId в сессии: hasCompany=false и каталог не читаем', async () => {
    const props = await renderPage(LeaderPriceListPage);

    expect(requireSettingsSection).toHaveBeenCalledWith('catalogs.priceList', 'leader');
    expect(props.cabinet).toBe('leader');
    expect(props.hasCompany).toBe(false);
    expect(props.activeCompanyId).toBeNull();
    expect(props.companies).toEqual([]);
    expect(props.items).toEqual([]);
    expect(listCatalogItems).not.toHaveBeenCalled();
  });

  it('со своей компанией: сервис зовётся ровно с ней, q/inactive доходят', async () => {
    const leaderWithCompany = { ...LEADER, companyId: 'c9' };
    requireSettingsSection.mockResolvedValueOnce(leaderWithCompany);
    const props = await renderPage(LeaderPriceListPage, { q: 'печать', inactive: '1' });

    expect(listCatalogItems).toHaveBeenCalledWith({}, leaderWithCompany, {
      companyId: 'c9',
      q: 'печать',
      includeInactive: true,
    });
    expect(props.hasCompany).toBe(true);
    expect(props.activeCompanyId).toBe('c9');
    expect(props.companies).toEqual([]);
    expect(props.items).toEqual([ITEM]);
  });

  it('отказ сервиса (чужая компания в сессии) не роняет страницу', async () => {
    requireSettingsSection.mockResolvedValueOnce({ ...LEADER, companyId: 'c9' });
    listCatalogItems.mockResolvedValue({ ok: false, error: 'forbidden' });
    const props = await renderPage(LeaderPriceListPage);
    expect(props.items).toEqual([]);
  });
});
