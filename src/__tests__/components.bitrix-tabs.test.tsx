// @vitest-environment jsdom
/**
 * Вкладки раздела «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, `У-188`):
 * «Подключение» и «Пакеты», активная — по текущему адресу.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, within } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/admin/settings' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { BitrixTabs } from '@/components/settings/bitrix-tabs';

const BASE = '/admin/settings/integrations/bitrix';

beforeEach(() => {
  nav.pathname = '/admin/settings';
});

describe('BitrixTabs', () => {
  it('две вкладки с адресами раздела; на корне активно «Подключение»', () => {
    nav.pathname = BASE;
    const { container } = render(<BitrixTabs />);

    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Разделы миграции из Битрикс24'
    );

    const links = within(container).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Подключение', 'Пакеты']);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/admin/settings/integrations/bitrix',
      '/admin/settings/integrations/bitrix/history',
    ]);
    expect(links.map((l) => l.getAttribute('data-active'))).toEqual(['true', 'false']);
    // Активная вкладка подчёркнута оранжевым, остальные — прозрачной линией.
    expect(links[0]?.className).toContain('border-[#F97316]');
    expect(links[1]?.className).toContain('border-transparent');
  });

  it('на «Пакетах» активна вторая вкладка', () => {
    nav.pathname = `${BASE}/history`;
    const { container } = render(<BitrixTabs />);
    const links = within(container).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('data-active'))).toEqual(['false', 'true']);
  });

  it('на карточке пакета вкладка «Пакеты» остаётся подсвеченной', () => {
    // Карточка живёт под «Пакетами» (`.../history/<id>`). Если бы обе вкладки
    // погасли, человек перестал бы понимать, где он (§15, «где я»).
    nav.pathname = `${BASE}/history/b-42`;
    const { container } = render(<BitrixTabs />);
    const links = within(container).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('data-active'))).toEqual(['false', 'true']);
    expect(links[1]?.className).toContain('border-[#F97316]');
    // «Подключение» сравнивается на точное равенство — вложенный адрес его не зажигает.
    expect(links[0]?.className).toContain('border-transparent');
  });

  it('на чужом адресе ни одна вкладка не активна', () => {
    nav.pathname = '/admin/settings/integrations/messengers';
    const { container } = render(<BitrixTabs />);
    const links = within(container).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('data-active'))).toEqual(['false', 'false']);
  });
});
