// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * Небольшие, но заметные ветки навигации и фильтров.
 *
 * Общая мысль: **хвост адреса не должен теряться**. Переключил вкладку —
 * выбранный месяц и компания остаются; выбрал компанию — вкладка не
 * сбрасывается. Иначе человек каждый раз заново набирает то, что уже выбрал.
 *
 * Плюс две двери: вкладки обмена с 1С урезаются для менеджера (расписаниями
 * управляет не тот, кто грузит файлы), а ссылка «все уведомления» появляется
 * только когда центр уведомлений включён — иначе она вела бы в никуда.
 */
const nav = vi.hoisted(() => ({ pathname: '/manager/settings/integrations/1c/excel' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({
  isFeatureEnabled: flags.isFeatureEnabled,
  notFoundIfDisabled: vi.fn(),
}));

import { OneCTabs } from '@/components/settings/one-c-tabs';
import { CompanyPicker } from '@/components/leader/analytics/company-picker';
import { AnalyticsTabs } from '@/components/leader/analytics/analytics-tabs';
import { UsersFilters } from '@/components/admin/users-filters';

beforeEach(() => {
  vi.clearAllMocks();
  flags.isFeatureEnabled.mockReturnValue(true);
  nav.pathname = '/manager/settings/integrations/1c/excel';
});

describe('OneCTabs — вкладки обмена с 1С', () => {
  it('без ограничения показываются все вкладки', () => {
    render(<OneCTabs cabinet="admin" />);

    expect(screen.getAllByRole('link').length).toBeGreaterThan(2);
  });

  it('менеджеру список урезан — «Автообмен» ему не показывают', () => {
    render(<OneCTabs cabinet="manager" only={['excel']} />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toContain('/excel');
  });

  it('текущая вкладка помечена — видно, где ты', () => {
    render(<OneCTabs cabinet="manager" only={['excel']} />);

    expect(screen.getByRole('link').dataset.active).toBe('true');
  });
});

describe('CompanyPicker — выбор компании', () => {
  const companies = [
    { id: 'c1', name: 'Первая' },
    { id: 'c2', name: 'Вторая' },
  ];

  it('одна компания — выбирать не из чего, переключателя нет', () => {
    render(<CompanyPicker basePath="/leader/analytics" companies={[companies[0]!]} active="c1" />);

    expect(screen.queryByTestId('company-picker')).toBeNull();
  });

  it('хвост адреса сохраняется при переключении компании', () => {
    render(
      <CompanyPicker
        basePath="/leader/analytics"
        companies={companies}
        active="c1"
        query={{ month: '2026-09', tab: 'receivables' }}
      />
    );

    const second = screen.getByRole('link', { name: 'Вторая' });
    expect(second.getAttribute('href')).toContain('month=2026-09');
    expect(second.getAttribute('href')).toContain('tab=receivables');
    expect(second.getAttribute('href')).toContain('company=c2');
  });

  it('без хвоста ссылка всё равно собирается', () => {
    render(<CompanyPicker basePath="/leader/analytics" companies={companies} active="c1" />);

    expect(screen.getByRole('link', { name: 'Вторая' }).getAttribute('href')).toBe(
      '/leader/analytics?company=c2'
    );
  });

  it('текущая компания помечена для чтения с экрана', () => {
    render(<CompanyPicker basePath="/leader/analytics" companies={companies} active="c1" />);

    expect(screen.getByRole('link', { name: 'Первая' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('AnalyticsTabs — вкладки аналитики', () => {
  it('месяц и компания не теряются при переключении вкладки', () => {
    render(
      <AnalyticsTabs
        basePath="/leader/analytics"
        active="funnel"
        query={{ month: '2026-09', company: 'c2' }}
      />
    );

    const links = screen.getAllByRole('link');
    expect(links[0]?.getAttribute('href')).toContain('month=2026-09');
    expect(links[0]?.getAttribute('href')).toContain('company=c2');
  });

  it('без хвоста ссылка содержит только вкладку', () => {
    render(<AnalyticsTabs basePath="/leader/analytics" active="funnel" />);

    const links = screen.getAllByRole('link');
    expect(links[0]?.getAttribute('href')).toMatch(/^\/leader\/analytics\?tab=/);
  });
});

describe('UsersFilters — фильтры списка пользователей', () => {
  it('без списка компаний поля выбора компании нет', () => {
    render(<UsersFilters />);

    expect(screen.queryByText('Все компании')).toBeNull();
  });

  it('выбранная компания подставлена; «все компании» — пустое значение', () => {
    const { unmount } = render(
      <UsersFilters companies={[{ id: 'c1', name: 'Первая' }]} companyId="c1" />
    );
    expect((screen.getByDisplayValue('Первая') as HTMLSelectElement).value).toBe('c1');
    unmount();

    render(<UsersFilters companies={[{ id: 'c1', name: 'Первая' }]} />);
    expect((screen.getByDisplayValue('Все компании') as HTMLSelectElement).value).toBe('');
  });
});
