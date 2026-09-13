// @vitest-environment jsdom
/**
 * Раздел «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026): страница
 * «Подключение» (`У-188`, `У-199`), «Пакеты» с формой файлов выгрузки,
 * формой нового пакета и списком пакетов (`У-198`, `У-193`, `У-189` file) и
 * общий layout с вкладками.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSettingsView, getSettingValues } = vi.hoisted(() => ({
  getSettingsView: vi.fn(),
  getSettingValues: vi.fn(),
}));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView, getSettingValues }));

// Список берётся у истории, а не у предпросмотра: строке нужны отчёт сверки
// и посчитанное состояние отката, иначе кнопка в списке была бы догадкой.
const { listBitrixHistory } = vi.hoisted(() => ({ listBitrixHistory: vi.fn() }));
vi.mock('@/lib/services/bitrix/history', () => ({ listBitrixHistory }));

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
// Форма файлов выгрузки — клиентский компонент со своим тестом
// (components.bitrix-upload-form): странице важно лишь, что она на месте.
vi.mock('@/components/bitrix/upload-form', () => ({
  BitrixUploadForm: () => React.createElement('div', { 'data-testid': 'bitrix-upload-form' }),
}));
// Форма нового пакета и список пакетов — со своими тестами
// (components.bitrix-new-batch-form, components.bitrix-batch-views): странице
// важно, что они на месте и с какими данными.
type NewBatchStubProps = {
  managers: { id: string; name: string }[];
  fileKeys: unknown[];
  hasConnection: boolean;
};
const { newBatchProps, batchListProps } = vi.hoisted(() => ({
  newBatchProps: [] as NewBatchStubProps[],
  batchListProps: [] as { batches: Record<string, unknown>[] }[],
}));
vi.mock('@/components/bitrix/new-batch-form', () => ({
  NewBatchForm: (props: NewBatchStubProps) => {
    newBatchProps.push(props);
    return React.createElement('div', { 'data-testid': 'bitrix-new-batch-form' });
  },
}));
vi.mock('@/components/bitrix/batch-list', () => ({
  BatchList: (props: { batches: Record<string, unknown>[] }) => {
    batchListProps.push(props);
    return React.createElement(
      'div',
      { 'data-testid': 'bitrix-batch-list' },
      String(props.batches.length)
    );
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
  newBatchProps.length = 0;
  batchListProps.length = 0;
  listBitrixHistory.mockResolvedValue({ ok: true, batches: [] });
  getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': null });
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

describe('AdminBitrixHistoryPage («Пакеты»)', () => {
  it('гард раздела, шапка, обе формы по порядку действий и пустое состояние с кнопкой', async () => {
    const { container } = await renderServerComponent(AdminBitrixHistoryPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.bitrix', 'admin');
    expect(listBitrixHistory).toHaveBeenCalledWith({}, ADMIN_WITH_COMPANY);
    expect(getSettingValues).toHaveBeenCalledWith({}, ['bitrix.webhookUrl']);
    expect(container.querySelector('h1')?.textContent).toBe('Пакеты миграции');
    const text = container.textContent ?? '';
    expect(text).toContain('предпросмотр, применение, отчёт сверки и откат');

    // Порядок на экране повторяет порядок действий: загрузить выгрузки →
    // собрать пакет → посмотреть результат.
    const order = [...container.querySelectorAll('[data-testid]')].map((el) =>
      el.getAttribute('data-testid')
    );
    expect(order).toEqual(['bitrix-upload-form', 'bitrix-new-batch-form']);

    // §15: пустой экран объясняет, что делать дальше, и даёт кнопку.
    expect(container.querySelector('[data-testid="bitrix-batch-list"]')).toBeNull();
    expect(text).toContain('Здесь пока пусто');
    expect(text).toContain(
      'Пакетов миграции ещё не было. Подключите портал или загрузите выгрузки выше, а затем посчитайте предпросмотр — он покажет, что перенесётся.'
    );
    const link = container.querySelector('a[href="/admin/settings/integrations/bitrix"]');
    expect(link?.textContent).toBe('К подключению');
  });

  it('пакеты есть — вместо пустого состояния список, форма нового пакета остаётся', async () => {
    listBitrixHistory.mockResolvedValue({
      ok: true,
      batches: [{ id: 'b-1' }, { id: 'b-2' }],
    });
    const { container } = await renderServerComponent(AdminBitrixHistoryPage());

    expect(container.querySelector('[data-testid="bitrix-batch-list"]')?.textContent).toBe('2');
    expect(batchListProps[0]?.batches.map((b) => b['id'])).toEqual(['b-1', 'b-2']);
    expect(container.querySelector('[data-testid="bitrix-new-batch-form"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Здесь пока пусто');
  });

  it('отчёт и состояние отката доезжают до списка как есть — страница их не пересчитывает', async () => {
    // `У-196`, `У-198`: можно ли откатить строку, знает сервис — он смотрит
    // статус, дату применения и журнал записей. Страница, посчитавшая это
    // сама, рано или поздно разойдётся с самим откатом.
    listBitrixHistory.mockResolvedValue({
      ok: true,
      batches: [
        { id: 'b-1', hasReport: true, rollback: 'available', rollbackHint: '' },
        {
          id: 'b-2',
          hasReport: false,
          rollback: 'expired',
          rollbackHint: 'Откат возможен 30 дней после применения — срок вышел.',
        },
      ],
    });
    await renderServerComponent(AdminBitrixHistoryPage());

    expect(batchListProps[0]?.batches).toEqual([
      { id: 'b-1', hasReport: true, rollback: 'available', rollbackHint: '' },
      {
        id: 'b-2',
        hasReport: false,
        rollback: 'expired',
        rollbackHint: 'Откат возможен 30 дней после применения — срок вышел.',
      },
    ]);
  });

  it('сервис отказал (нет компании у сессии) — экран не падает, а показывает пустое состояние', async () => {
    requireSettingsSection.mockResolvedValue(ADMIN_NO_COMPANY);
    listBitrixHistory.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminBitrixHistoryPage());

    // Менеджеров у сессии без компании не спрашиваем вовсе.
    expect(listCompanyManagers).not.toHaveBeenCalled();
    expect(newBatchProps[0]?.managers).toEqual([]);
    expect(container.querySelector('[data-testid="bitrix-batch-list"]')).toBeNull();
    expect(container.textContent).toContain('Здесь пока пусто');
  });

  it('форма нового пакета: только активные менеджеры, ключей выгрузок ещё нет, вебхук задан', async () => {
    listCompanyManagers.mockResolvedValue([
      manager('m1', 'Анна', true),
      manager('m2', 'Борис', false),
      manager('m3', 'Вера', true),
    ]);
    getSettingValues.mockResolvedValue({
      'bitrix.webhookUrl': 'https://company.bitrix24.ru/rest/1/abc/',
    });
    await renderServerComponent(AdminBitrixHistoryPage());

    expect(listCompanyManagers).toHaveBeenCalledWith({}, 'c1');
    expect(newBatchProps).toHaveLength(1);
    expect(newBatchProps[0]).toEqual({
      managers: [
        { id: 'm1', name: 'Анна' },
        { id: 'm3', name: 'Вера' },
      ],
      // Ключи выгрузок приедут следующим шагом: форма файлов держит их у себя.
      fileKeys: [],
      hasConnection: true,
    });
  });

  it.each([
    ['вебхука нет вовсе', null],
    ['вебхук записан пустым', ''],
  ])('%s — форма знает, что портал не подключён', async (_name, value) => {
    getSettingValues.mockResolvedValue({ 'bitrix.webhookUrl': value });
    await renderServerComponent(AdminBitrixHistoryPage());
    expect(newBatchProps[0]?.hasConnection).toBe(false);
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
