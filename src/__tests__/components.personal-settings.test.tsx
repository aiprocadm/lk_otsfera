import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & Record<string, unknown>) => React.createElement('a', { href, ...rest }, children),
}));

import { PersonalSettings } from '@/components/settings/personal-settings';
import { personalSettingsTabsFor } from '@/lib/navigation/personalSettings';

/**
 * Личные настройки — один экран на пять кабинетов (`У-114`, решение `Р-23`).
 *
 * Здесь важны три вещи, каждая из которых ломается тихо:
 * вкладка «Команда» не должна появляться там, где командой не управляют;
 * незнакомый `?tab=` в адресе (чужая ссылка, опечатка) не должен давать
 * пустой экран; и подпись «что здесь делают» обязана меняться вместе со
 * вкладкой, иначе человек читает объяснение не про то, что видит.
 */
const slots = {
  profile: React.createElement('p', null, 'СОДЕРЖИМОЕ ПРОФИЛЯ'),
  notifications: React.createElement('p', null, 'СОДЕРЖИМОЕ УВЕДОМЛЕНИЙ'),
  security: React.createElement('p', null, 'СОДЕРЖИМОЕ БЕЗОПАСНОСТИ'),
  team: React.createElement('p', null, 'СОДЕРЖИМОЕ КОМАНДЫ'),
};

const html = (over: Partial<React.ComponentProps<typeof PersonalSettings>> = {}) =>
  renderToString(
    React.createElement(PersonalSettings, {
      basePath: '/manager/settings',
      activeTab: 'profile',
      slots,
      ...over,
    })
  ).replace(/<!-- -->/g, '');

describe('PersonalSettings', () => {
  it('вкладки и их порядок берутся из реестра, а не переписываются в разметке', () => {
    const out = html();
    for (const tab of personalSettingsTabsFor()) {
      expect(out, tab.key).toContain(`data-testid="personal-tab-${tab.key}"`);
      expect(out, tab.key).toContain(tab.label);
    }
    expect(out).toContain('href="/manager/settings?tab=security"');
  });

  it('«Команда» появляется только там, где ею управляют', () => {
    expect(html()).not.toContain('personal-tab-team');
    expect(html({ team: true })).toContain('personal-tab-team');
  });

  it('открытая вкладка подсвечена, её содержимое показано, чужое — нет', () => {
    const out = html({ activeTab: 'security' });
    expect(out).toContain('data-testid="personal-tab-security" data-active="true"');
    expect(out).toContain('data-testid="personal-tab-profile" data-active="false"');
    expect(out).toContain('СОДЕРЖИМОЕ БЕЗОПАСНОСТИ');
    expect(out).not.toContain('СОДЕРЖИМОЕ ПРОФИЛЯ');
  });

  it('подпись «что здесь делают» меняется вместе со вкладкой (§15)', () => {
    const tabs = personalSettingsTabsFor();
    const profile = tabs.find((t) => t.key === 'profile')!;
    const security = tabs.find((t) => t.key === 'security')!;
    expect(profile.description).not.toBe(security.description);
    expect(html()).toContain(profile.description);
    expect(html({ activeTab: 'security' })).toContain(security.description);
  });

  it('вкладка из адреса, которой у этой роли нет, открывает первую, а не пустоту', () => {
    // Ссылку на «Команду» мог прислать партнёр-администратор коллеге, у
    // которого этой вкладки нет. Пустой экран без объяснения — тупик (§15);
    // человек должен оказаться на первой вкладке с её содержимым.
    const out = html({ activeTab: 'team' });
    expect(out).toContain('СОДЕРЖИМОЕ ПРОФИЛЯ');
    expect(out).toContain('data-testid="personal-tab-profile" data-active="true"');
    expect(out).not.toContain('СОДЕРЖИМОЕ КОМАНДЫ');
  });

  it('содержимого вкладки не дали — экран всё равно рисует шапку и подпись', () => {
    // Страница роли может не передать узел (раздел ей не положен). Падать
    // из-за этого нельзя: переключатель и объяснение остаются на месте.
    const out = html({ slots: {} });
    expect(out).toContain('data-testid="personal-tab-profile"');
    expect(out).toContain(personalSettingsTabsFor()[0]!.description);
  });
});
