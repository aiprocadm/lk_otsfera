// @vitest-environment jsdom
/**
 * Раздел «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, PR-1 «основа»):
 * страница «Подключение» (`У-188`, `У-199`), заглушка «Пакеты» (`У-198`) и
 * общий layout с вкладками.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSettingsView } = vi.hoisted(() => ({ getSettingsView: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView }));

const { isSecretsKeyConfigured } = vi.hoisted(() => ({ isSecretsKeyConfigured: vi.fn() }));
vi.mock('@/lib/crypto/secrets', () => ({ isSecretsKeyConfigured }));

const { loadIntegrationDiagnostics, checkOf } = vi.hoisted(() => ({
  loadIntegrationDiagnostics: vi.fn(),
  checkOf: vi.fn(),
}));
vi.mock('@/lib/services/admin/integrationDiagnostics', () => ({ loadIntegrationDiagnostics }));

const { listCompanyManagers } = vi.hoisted(() => ({ listCompanyManagers: vi.fn() }));
vi.mock('@/lib/services/manager/team', () => ({ listCompanyManagers }));

// Вкладки — клиентский компонент: ему нужен адрес страницы.
vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/settings/integrations/bitrix',
}));

type FieldStub = {
  name: string;
  label: string;
  kind: string;
  initialValue?: string;
  settingKey?: string;
  source?: string;
  secretSet?: boolean;
  secretSource?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};
type FormStubProps = {
  title: string;
  description?: string;
  note?: string;
  action: unknown;
  testAction?: unknown;
  check?: unknown;
  fields: FieldStub[];
};
const { formProps } = vi.hoisted(() => ({ formProps: [] as FormStubProps[] }));
vi.mock('@/components/admin/integration-settings-form', () => ({
  IntegrationSettingsForm: (props: FormStubProps) => {
    formProps.push(props);
    return React.createElement('div', { 'data-testid': 'integration-form' }, props.title);
  },
}));
vi.mock('@/components/admin/secrets-key-notice', () => ({
  SecretsKeyNotice: (props: { ready: boolean }) =>
    React.createElement(
      'div',
      { 'data-testid': 'secrets-notice' },
      props.ready ? 'ready' : 'missing'
    ),
}));

const { saveBitrixConnectionAction, testBitrixConnectionAction } = vi.hoisted(() => ({
  saveBitrixConnectionAction: vi.fn(),
  testBitrixConnectionAction: vi.fn(),
}));
vi.mock('@/server-actions/admin/bitrix', () => ({
  saveBitrixConnectionAction,
  testBitrixConnectionAction,
}));

import AdminBitrixSettingsPage from '@/app/admin/settings/integrations/bitrix/page';
import AdminBitrixHistoryPage from '@/app/admin/settings/integrations/bitrix/history/page';
import AdminBitrixLayout from '@/app/admin/settings/integrations/bitrix/layout';

const ADMIN_WITH_COMPANY = { sub: 'admin1', role: 'admin' as const, companyId: 'c1' };
const ADMIN_NO_COMPANY = { sub: 'admin2', role: 'admin' as const };

type ViewRow = {
  key: string;
  isSecret: boolean;
  isSet: boolean;
  value: string | null;
  source: string;
};
function viewFor(keys: string[], make: (key: string) => Partial<ViewRow>): ViewRow[] {
  return keys.map((key) => ({
    key,
    isSecret: key === 'bitrix.webhookUrl',
    isSet: false,
    value: null,
    source: 'none',
    ...make(key),
  }));
}

function manager(id: string, name: string, isActive: boolean) {
  return {
    id,
    name,
    email: `${id}@demo.local`,
    isActive,
    isLeader: false,
    lastLoginAt: null,
    assignments: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  formProps.length = 0;
  requireSettingsSection.mockResolvedValue(ADMIN_WITH_COMPANY);
  isSecretsKeyConfigured.mockReturnValue(true);
  checkOf.mockReturnValue(null);
  loadIntegrationDiagnostics.mockResolvedValue({ checkOf });
  listCompanyManagers.mockResolvedValue([]);
  getSettingsView.mockImplementation(async (_prisma: unknown, keys: string[]) =>
    viewFor(keys, () => ({}))
  );
});

describe('AdminBitrixSettingsPage («Подключение»)', () => {
  it('гард раздела, шапка, шаги подключения, ссылка на «Функции платформы», форма с тремя полями', async () => {
    getSettingsView.mockImplementation(async (_prisma: unknown, keys: string[]) =>
      viewFor(keys, (key) => {
        if (key === 'bitrix.portalUrl') return { value: 'company.bitrix24.ru', source: 'db' };
        if (key === 'bitrix.webhookUrl') return { isSet: true, source: 'db' };
        return { value: 'm1', source: 'db' };
      })
    );
    listCompanyManagers.mockResolvedValue([
      manager('m1', 'Анна', true),
      manager('m2', 'Борис', false), // неактивный — в список не попадает
      manager('m3', 'Вера', true),
    ]);
    checkOf.mockImplementation((key: string) => ({
      lastAt: `t-${key}`,
      lastOk: true,
      lastError: null,
    }));

    const { container } = await renderServerComponent(AdminBitrixSettingsPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(getSettingsView).toHaveBeenCalledWith({}, [
      'bitrix.portalUrl',
      'bitrix.webhookUrl',
      'bitrix.defaultManagerId',
    ]);
    expect(loadIntegrationDiagnostics).toHaveBeenCalledWith({}, []);
    expect(listCompanyManagers).toHaveBeenCalledWith({}, 'c1');

    // Шапка: «где я» и «что здесь делают».
    expect(container.querySelector('h1')?.textContent).toBe('Миграция из Битрикс24');
    const text = container.textContent ?? '';
    expect(text).toContain('Подключите портал по входящему вебхуку');

    // Шаги «Как подключить» — четыре, по порядку.
    expect(text).toContain('Как подключить');
    const steps = [...container.querySelectorAll('ol li')].map((li) => li.textContent ?? '');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain('Входящий вебхук');
    expect(steps[1]).toContain('менеджера по умолчанию');
    expect(steps[2]).toContain('Проверить подключение');
    expect(steps[3]).toContain('вкладке «Пакеты»');
    expect(text).toContain('в журналах остаётся только домен портала');

    // Ссылка на «Функции платформы».
    const flagsLink = container.querySelector('a[href="/admin/settings/system/feature-flags"]');
    expect(flagsLink?.textContent).toContain('Функциях платформы');

    // Ключ шифрования задан — баннер получает ready=true.
    expect(container.querySelector('[data-testid="secrets-notice"]')?.textContent).toBe('ready');

    // Форма: одна, с тремя полями и обоими действиями.
    expect(formProps).toHaveLength(1);
    const form = formProps[0]!;
    expect(form.title).toBe('Портал Битрикс24');
    expect(form.description).toContain('входящий вебхук');
    expect(form).not.toHaveProperty('note'); // менеджеры есть — подсказка не нужна
    expect(form.action).toBe(saveBitrixConnectionAction);
    expect(form.testAction).toBe(testBitrixConnectionAction);
    expect(checkOf).toHaveBeenCalledWith('bitrix');
    expect(form.check).toEqual({ lastAt: 't-bitrix', lastOk: true, lastError: null });

    expect(form.fields.map((f) => f.name)).toEqual([
      'bitrix_portalUrl',
      'bitrix_webhookUrl',
      'bitrix_defaultManagerId',
    ]);
    const [portal, webhook, managerField] = form.fields;
    expect(portal).toMatchObject({
      label: 'Адрес портала',
      kind: 'text',
      initialValue: 'company.bitrix24.ru',
      settingKey: 'bitrix.portalUrl',
      source: 'db',
      placeholder: 'company.bitrix24.ru',
    });
    // Вебхук — секрет: на экран уходит только «задан / не задан», без значения.
    expect(webhook).toMatchObject({
      label: 'Входящий вебхук',
      kind: 'secret',
      secretSet: true,
      secretSource: 'db',
      settingKey: 'bitrix.webhookUrl',
    });
    expect(webhook).not.toHaveProperty('initialValue');
    // Менеджер по умолчанию: «не выбран» + только активные менеджеры компании.
    expect(managerField).toMatchObject({
      label: 'Менеджер по умолчанию',
      kind: 'select',
      initialValue: 'm1',
      settingKey: 'bitrix.defaultManagerId',
      source: 'db',
    });
    expect(managerField?.options).toEqual([
      { value: '', label: '— не выбран —' },
      { value: 'm1', label: 'Анна (m1@demo.local)' },
      { value: 'm3', label: 'Вера (m3@demo.local)' },
    ]);
  });

  it('сессия без компании: менеджеров не спрашиваем, форма объясняет пустой список; пустые настройки → пустые поля', async () => {
    requireSettingsSection.mockResolvedValue(ADMIN_NO_COMPANY);
    isSecretsKeyConfigured.mockReturnValue(false);

    const { container } = await renderServerComponent(AdminBitrixSettingsPage());

    expect(listCompanyManagers).not.toHaveBeenCalled();
    // Ключа шифрования нет — баннер получает ready=false.
    expect(container.querySelector('[data-testid="secrets-notice"]')?.textContent).toBe('missing');

    const form = formProps[0]!;
    // У сессии нет компании — подсказка объясняет именно это, а не «нет активных менеджеров».
    expect(form.note).toContain('нет компании');
    expect(form.check).toBeNull();
    const [portal, webhook, managerField] = form.fields;
    expect(portal?.initialValue).toBe('');
    expect(portal?.source).toBe('none');
    expect(webhook?.secretSet).toBe(false);
    expect(managerField?.initialValue).toBe('');
    expect(managerField?.options).toEqual([{ value: '', label: '— не выбран —' }]);
  });

  it('в компании только неактивные менеджеры — подсказка показывается, список пустой', async () => {
    listCompanyManagers.mockResolvedValue([manager('m2', 'Борис', false)]);

    await renderServerComponent(AdminBitrixSettingsPage());

    expect(listCompanyManagers).toHaveBeenCalledWith({}, 'c1');
    const form = formProps[0]!;
    expect(form.note).toContain('активные менеджеры');
    expect(form.fields[2]?.options).toEqual([{ value: '', label: '— не выбран —' }]);
  });
});

describe('AdminBitrixHistoryPage («Пакеты», заглушка PR-1)', () => {
  it('гард раздела, шапка, пустое состояние с кнопкой «К подключению»', async () => {
    const { container } = await renderServerComponent(AdminBitrixHistoryPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(container.querySelector('h1')?.textContent).toBe('Пакеты миграции');
    const text = container.textContent ?? '';
    expect(text).toContain('предпросмотр, применение, отчёт сверки и откат');
    // §15: пустой экран объясняет, что делать дальше, и даёт кнопку.
    expect(text).toContain('Здесь пока пусто');
    expect(text).toContain('Пакетов миграции ещё не было');
    const link = container.querySelector('a[href="/admin/settings/integrations/bitrix"]');
    expect(link?.textContent).toBe('К подключению');
  });
});

describe('AdminBitrixLayout', () => {
  it('рисует вкладки раздела и содержимое страницы', () => {
    const { container } = render(
      <AdminBitrixLayout>
        <div data-testid="child">содержимое</div>
      </AdminBitrixLayout>
    );

    const nav = container.querySelector('nav[aria-label="Разделы миграции из Битрикс24"]');
    expect(nav).not.toBeNull();
    const links = [...(nav?.querySelectorAll('a') ?? [])];
    expect(links.map((a) => a.textContent)).toEqual(['Подключение', 'Пакеты']);
    expect(links[0]?.getAttribute('data-active')).toBe('true');
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('содержимое');
    // Гарда в layout нет намеренно (§2b): право проверяет каждая страница сама.
    expect(requireSettingsSection).not.toHaveBeenCalled();
  });
});
