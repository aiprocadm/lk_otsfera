// @vitest-environment jsdom
/**
 * UI хаба «Настройки»: карточки с поиском (ТЗ §3, §4.4), боковая навигация с
 * мобильным выпадающим списком (§4.2), крошки (§4.3) и вкладки «Обмен с 1С».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, fireEvent, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  pathname: '/admin/settings',
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: vi.fn() }),
}));

import { SettingsHubCards } from '@/components/settings/settings-hub-cards';
import { SettingsNav } from '@/components/settings/settings-nav';
import { SettingsBreadcrumbs } from '@/components/settings/settings-breadcrumbs';
import { OneCTabs } from '@/components/settings/one-c-tabs';
import { sectionsForCabinet, SETTINGS_SECTIONS } from '@/lib/navigation/settings';

const adminSections = sectionsForCabinet('admin');

beforeEach(() => {
  nav.pathname = '/admin/settings';
  nav.push.mockReset();
});

describe('карточки хаба', () => {
  it('четыре группы ТЗ и карточка на каждый доступный раздел', () => {
    const { container } = render(<SettingsHubCards cabinet="admin" sections={adminSections} />);
    const headings = [...container.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual([
      'Интеграции',
      'Конфигурация процессов',
      'Доступ и роли',
      'Безопасность и система',
    ]);
    expect(container.querySelectorAll('a[data-testid^="settings-card-"]').length).toBe(
      adminSections.length
    );
  });

  it('карточка ведёт на адрес своего кабинета', () => {
    const { container } = render(
      <SettingsHubCards cabinet="leader" sections={sectionsForCabinet('leader')} />
    );
    const roles = container.querySelector('a[data-testid="settings-card-access.roles"]');
    expect(roles?.getAttribute('href')).toBe('/leader/settings/access/roles');
  });

  it('поиск фильтрует по названию и по описанию', () => {
    const { container, getByTestId } = render(
      <SettingsHubCards cabinet="admin" sections={adminSections} />
    );
    fireEvent.change(getByTestId('settings-search'), { target: { value: 'аудит' } });
    expect(container.querySelectorAll('a[data-testid^="settings-card-"]').length).toBe(1);
    expect(container.textContent).toContain('Аудит');

    // «152-ФЗ» есть только в описании журнала ПДн — проверяем, что описание тоже ищется.
    fireEvent.change(getByTestId('settings-search'), { target: { value: '152-ФЗ' } });
    expect(
      container.querySelector('a[data-testid="settings-card-security.personalData"]')
    ).not.toBeNull();
  });

  it('ничего не найдено — понятная заглушка, а не пустой экран', () => {
    const { container, getByTestId } = render(
      <SettingsHubCards cabinet="admin" sections={adminSections} />
    );
    fireEvent.change(getByTestId('settings-search'), { target: { value: 'зззз' } });
    expect(container.textContent).toContain('Ничего не найдено');
  });

  it('разделов нет (нет прав) — карточек нет', () => {
    const { container } = render(<SettingsHubCards cabinet="admin" sections={[]} />);
    expect(container.querySelectorAll('a[data-testid^="settings-card-"]').length).toBe(0);
  });
});

describe('боковая навигация', () => {
  it('активен раздел текущего адреса, включая вложенную вкладку', () => {
    nav.pathname = '/admin/settings/integrations/1c/excel';
    const { container } = render(<SettingsNav cabinet="admin" sections={adminSections} />);
    const active = container.querySelector('[data-testid="settings-nav-integrations.oneC"]');
    expect(active?.getAttribute('data-active')).toBe('true');
    expect(
      container
        .querySelector('[data-testid="settings-nav-integrations.overview"]')
        ?.getAttribute('data-active')
    ).toBe('false');
  });

  it('на корне хаба подсвечен пункт «Все настройки»', () => {
    const { container } = render(<SettingsNav cabinet="admin" sections={adminSections} />);
    const nested = [...container.querySelectorAll('[data-testid^="settings-nav-"]')];
    expect(nested.every((el) => el.getAttribute('data-active') === 'false')).toBe(true);
  });

  it('на узком экране выбор в списке переводит на раздел', () => {
    const { getByLabelText } = render(<SettingsNav cabinet="admin" sections={adminSections} />);
    fireEvent.change(getByLabelText('Раздел настроек'), {
      target: { value: '/admin/settings/security/audit' },
    });
    expect(nav.push).toHaveBeenCalledWith('/admin/settings/security/audit');
  });

  it('пустая группа не рисует заголовок', () => {
    const onlyAudit = SETTINGS_SECTIONS.filter((s) => s.id === 'security.audit');
    const { container } = render(<SettingsNav cabinet="admin" sections={onlyAudit} />);
    const groupTitles = [...container.querySelectorAll('nav div div')].map((d) => d.textContent);
    expect(groupTitles).toContain('Безопасность и система');
    expect(groupTitles).not.toContain('Интеграции');
  });
});

describe('хлебные крошки', () => {
  it('цепочка «Настройки → группа → раздел», текущая крошка без ссылки', () => {
    nav.pathname = '/admin/settings/integrations/1c/payments';
    const { container } = render(<SettingsBreadcrumbs cabinet="admin" />);
    expect(container.textContent).toContain('Настройки');
    expect(container.textContent).toContain('Интеграции');
    expect(container.textContent).toContain('Обмен с 1С');
    const current = container.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('Обмен с 1С');
    // Промежуточная крошка-группа страницей не является и current-ом не помечена.
    expect(container.querySelectorAll('[aria-current="page"]').length).toBe(1);
  });

  it('на корне хаба крошек нет', () => {
    nav.pathname = '/admin/settings';
    const { container } = render(<SettingsBreadcrumbs cabinet="admin" />);
    expect(container.querySelector('nav')).toBeNull();
  });
});

describe('вкладки «Обмен с 1С»', () => {
  it('активна вкладка текущего адреса', () => {
    nav.pathname = '/admin/settings/integrations/1c/payments';
    const { container } = render(<OneCTabs />);
    const links = within(container).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Загрузка Excel', 'Выписка (сч. 51)']);
    expect(links[1]?.getAttribute('data-active')).toBe('true');
    expect(links[0]?.getAttribute('data-active')).toBe('false');
  });
});
