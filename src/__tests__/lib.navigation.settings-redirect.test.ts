import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import { legacyRedirectMap } from '@/lib/navigation/settings';
// next.config.mjs дублирует карту редиректов (читается до сборки, TS импортировать
// не может) — сверяем, чтобы списки не разъехались.
import { SETTINGS_HUB_REDIRECTS, LEGACY_REDIRECTS } from '../../next.config.mjs';

beforeEach(() => {
  isFeatureEnabled.mockReset();
  redirect.mockClear();
});

describe('redirectToSettingsHub', () => {
  it('флаг выключен — редиректа нет, страница остаётся на старом адресе', () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(() => redirectToSettingsHub('/admin/sync')).not.toThrow();
    expect(isFeatureEnabled).toHaveBeenCalledWith('settings_hub');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('флаг включён — уводит по карте редиректов', () => {
    isFeatureEnabled.mockReturnValue(true);
    expect(() => redirectToSettingsHub('/admin/sync')).toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/settings/integrations/1c/auto');
  });

  it('две загрузки 1С приезжают каждая на свою вкладку, а не на общий корень', () => {
    isFeatureEnabled.mockReturnValue(true);
    expect(() => redirectToSettingsHub('/admin/import')).toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/settings/integrations/1c/excel');
    expect(() => redirectToSettingsHub('/admin/payments-import')).toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/settings/integrations/1c/payments');
  });

  it('путь руководителя уводит в его кабинет, а не в админский', () => {
    isFeatureEnabled.mockReturnValue(true);
    expect(() => redirectToSettingsHub('/leader/roles')).toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/leader/settings/access/roles');
  });
});

describe('карта редиректов в next.config', () => {
  it('совпадает с реестром разделов один в один', () => {
    expect(Object.fromEntries(SETTINGS_HUB_REDIRECTS)).toEqual(
      Object.fromEntries(legacyRedirectMap())
    );
  });

  it('переезды вне хаба настроек ведут на конкретную вкладку, а не на экран целиком', () => {
    // Кабинет заказчика в реестр `SETTINGS_SECTIONS` не входит (он про
    // admin/leader), поэтому такие переезды живут отдельным списком. Проверяем
    // главное: адрес назначения несёт вкладку — без неё человек попадает на
    // «Обзор», где ни списка участников, ни кнопки приглашения нет (найдено
    // сопровождением 08.09.2026).
    const map = Object.fromEntries(LEGACY_REDIRECTS);
    expect(map['/organization/team']).toBe('/organization/company?tab=settings');
    for (const [from, to] of LEGACY_REDIRECTS) {
      expect(from.startsWith('/'), `${from}: адрес-источник должен быть путём`).toBe(true);
      expect(to, `${from}: назначение без вкладки уводит на «Обзор»`).toContain('?tab=');
    }
  });

  it('списки не пересекаются: один адрес — один переезд', () => {
    const hub = SETTINGS_HUB_REDIRECTS.map(([from]) => from);
    const legacy = LEGACY_REDIRECTS.map(([from]) => from);
    expect(hub.filter((from) => legacy.includes(from))).toEqual([]);
  });
});
