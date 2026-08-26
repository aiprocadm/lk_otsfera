// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

// Чтение SyncState уехало в сервис (аудит A1) — форма запроса пиннится в
// services.admin-integrations.test.ts.
const { getIntegrationsStatus, listIntegrationSyncStates } = vi.hoisted(() => ({
  getIntegrationsStatus: vi.fn(),
  listIntegrationSyncStates: vi.fn(),
}));
vi.mock('@/lib/services/admin/integrations', () => ({
  getIntegrationsStatus,
  listIntegrationSyncStates,
}));

const { getSettingsView } = vi.hoisted(() => ({ getSettingsView: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView }));

const { primeIntegrationSettingsCache } = vi.hoisted(() => ({
  primeIntegrationSettingsCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ primeIntegrationSettingsCache }));

// Этап 8 (`У-69`/`У-70`): светофор и переключатели каналов собирает сервис,
// а рисует клиентская панель — здесь подменяем обоих.
const { getIntegrationsHealth } = vi.hoisted(() => ({ getIntegrationsHealth: vi.fn() }));
vi.mock('@/lib/services/admin/integrationsHealth', () => ({ getIntegrationsHealth }));
const { healthRows } = vi.hoisted(() => ({ healthRows: [] as unknown[] }));
vi.mock('@/components/admin/integrations-health-panel', async () => {
  // React импортируем внутри фабрики: она поднимается выше импортов файла.
  const R = await import('react');
  return {
    IntegrationsHealthPanel: (props: { rows: unknown[] }) => {
      healthRows.splice(0, healthRows.length, ...props.rows);
      return R.createElement('div', { 'data-testid': 'health-panel' }, 'HEALTH');
    },
  };
});

// Client-компоненты форм — заглушки (SSR-тест страницы их не драйвит).
vi.mock('@/components/admin/email-settings-form', () => ({
  EmailSettingsForm: () => null,
}));
type FormStubProps = {
  title: string;
  check?: { lastAt: string; lastOk: boolean; lastError: string | null } | null;
  webhook?: {
    url: string;
    headerName: string | null;
    secretSet: boolean;
    lastEventAt: string | null;
  } | null;
  fields?: Array<{ name: string; initialValue?: string | boolean }>;
};
const { formTitles, formProps } = vi.hoisted(() => ({
  formTitles: [] as string[],
  formProps: [] as unknown[],
}));
vi.mock('@/components/admin/integration-settings-form', () => ({
  IntegrationSettingsForm: ({ title, check, webhook, fields }: FormStubProps) => {
    formTitles.push(title);
    // `fields` нужен тестам про разбор значений настроек (Ф3 программы покрытия).
    formProps.push({ title, check, webhook, fields });
    return null;
  },
}));
vi.mock('@/server-actions/admin/integrationSettings', () => ({
  saveTelegramSettingsAction: vi.fn(),
  saveMaxSettingsAction: vi.fn(),
  saveWhatsappSettingsAction: vi.fn(),
  saveMangoSettingsAction: vi.fn(),
  saveImapSettingsAction: vi.fn(),
  saveOnecSettingsAction: vi.fn(),
  saveDadataSettingsAction: vi.fn(),
  testIntegrationAction: vi.fn(),
}));

import AdminIntegrationsPage from '@/app/admin/settings/integrations/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

// Список ключей у страницы свой; дублировать его здесь нельзя — он уже
// разъезжался, когда страница добавила новые настройки, а тест продолжал
// возвращать старый набор, и `byKey()` падал на undefined. Отвечаем на то,
// что страница РЕАЛЬНО спросила.
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
    isSecret: key.endsWith('Key') || key.endsWith('Token') || key.endsWith('password'),
    isSet: false,
    value: null,
    source: 'none',
    ...make(key),
  }));
}

describe('AdminIntegrationsPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    getIntegrationsStatus.mockReset();
    getSettingsView.mockReset();
    primeIntegrationSettingsCache.mockClear();
    listIntegrationSyncStates.mockReset();
    listIntegrationSyncStates.mockResolvedValue([]);
    formTitles.length = 0;
    formProps.length = 0;
    requireSettingsSection.mockResolvedValue(SESSION);
    getSettingsView.mockImplementation(async (_prisma: unknown, keys: string[]) =>
      viewFor(keys, () => ({}))
    );
  });

  it('requires admin and renders the security notice + панель состояния', async () => {
    getIntegrationsHealth.mockResolvedValue({
      ok: true,
      rows: [
        { key: 'mango', label: 'Телефония (Mango Office)', status: 'ok' },
        { key: 'telegram', label: 'Telegram-бот', status: 'not_configured' },
      ],
    });

    const { container } = await renderServerComponent(AdminIntegrationsPage());

    expect(requireSettingsSection).toHaveBeenCalled();
    const text = container.textContent ?? '';
    // security notice: секреты в БД зашифрованы, env — запасной вариант
    expect(text).toContain('Секретные ключи хранятся в базе в зашифрованном виде');
    // Состояние интеграций рисует панель — страница отдаёт ей строки сервиса.
    expect(container.querySelector('[data-testid="health-panel"]')).not.toBeNull();
    expect(healthRows).toHaveLength(2);
    // все группы настроек смонтированы
    expect(formTitles).toEqual([
      'Telegram-бот',
      'Max-бот',
      'WhatsApp (агрегатор)',
      'Телефония Mango Office',
      'Входящая почта (IMAP)',
      'Обмен с 1С',
      'DaData (подсказки по ИНН)',
    ]);
  });

  it('отказ сервиса состояния — понятный текст вместо пустой панели', async () => {
    getIntegrationsHealth.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminIntegrationsPage());
    expect(container.querySelector('[data-testid="health-panel"]')).toBeNull();
    // Берём ВСЕ предупреждения: с `У-132` первым на странице может стоять
    // баннер об отсутствии ключа шифрования, и «первый alert» — уже не он.
    const alerts = [...container.querySelectorAll('[role="alert"]')].map((n) => n.textContent);
    expect(alerts.join(' | ')).toContain('Недостаточно прав');
  });

  it('включённые настройки и секреты из окружения отражаются в формах', async () => {
    // Экран настроек — единственное место, где админ видит, что реально
    // включено. Если бы разбор значений сломался, всё выглядело бы выключенным,
    // и админ полез бы «чинить» работающие интеграции.
    getIntegrationsStatus.mockReturnValue([]);
    getSettingsView.mockImplementation(async (_prisma: unknown, keys: string[]) =>
      viewFor(keys, (key) => ({
        // Значения приходят строками из БД — с регистром и пробелами.
        isSet: key === 'mango.apiKey' || key === 'mango.apiSalt',
        value:
          key === 'email.enabled' || key === 'dadata.enabled'
            ? '  TRUE  '
            : key === 'onec.adapter'
              ? ' REST '
              : null,
        source: 'db',
      }))
    );

    const prevTg = process.env.TELEGRAM_WEBHOOK_SECRET;
    const prevMax = process.env.MAX_WEBHOOK_SECRET;
    const prevWa = process.env.WHATSAPP_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = ' s1 ';
    process.env.MAX_WEBHOOK_SECRET = ' s2 ';
    process.env.WHATSAPP_WEBHOOK_SECRET = ' s3 ';
    try {
      await renderServerComponent(AdminIntegrationsPage());

      const onec = formProps.find(
        (p) => (p as FormStubProps).title === 'Обмен с 1С'
      ) as FormStubProps;
      const adapter = onec.fields?.find((f) => f.name === 'onec_adapter');
      // Значение « REST » с пробелами и в верхнем регистре — это «боевой обмен».
      expect(adapter?.initialValue).toBe('rest');
    } finally {
      if (prevTg === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
      else process.env.TELEGRAM_WEBHOOK_SECRET = prevTg;
      if (prevMax === undefined) delete process.env.MAX_WEBHOOK_SECRET;
      else process.env.MAX_WEBHOOK_SECRET = prevMax;
      if (prevWa === undefined) delete process.env.WHATSAPP_WEBHOOK_SECRET;
      else process.env.WHATSAPP_WEBHOOK_SECRET = prevWa;
    }
  });

  it('прокидывает в карточки результаты проб (SyncState) и диагностику вебхуков', async () => {
    getIntegrationsStatus.mockReturnValue([]);
    const ranAt = new Date('2026-07-23T10:00:00Z');
    const eventAt = new Date('2026-07-23T09:30:00Z');
    listIntegrationSyncStates.mockResolvedValue([
      { entity: 'integration.telegram', lastRunAt: ranAt, lastSuccessAt: ranAt, lastError: null },
      {
        entity: 'integration.onec',
        lastRunAt: ranAt,
        lastSuccessAt: null,
        lastError: 'Сервер ответил HTTP 500',
      },
      { entity: 'webhook.telegram', lastRunAt: null, lastSuccessAt: eventAt, lastError: null },
    ]);

    await renderServerComponent(AdminIntegrationsPage());

    const byTitle = (t: string) => (formProps as FormStubProps[]).find((p) => p.title === t)!;

    // Успешная проба: lastOk=true, ошибок нет.
    const tg = byTitle('Telegram-бот');
    expect(tg.check).toMatchObject({ lastOk: true, lastError: null });
    expect(tg.check!.lastAt).toBeTruthy();
    // Вебхук: готовый URL + имя заголовка + последнее входящее.
    expect(tg.webhook).toMatchObject({
      url: expect.stringContaining('/api/integrations/telegram/webhook'),
      headerName: 'x-telegram-bot-api-secret-token',
    });
    expect(tg.webhook!.lastEventAt).toBeTruthy();

    // Провальная проба 1С: lastOk=false + текст ошибки.
    const onec = byTitle('Обмен с 1С');
    expect(onec.check).toMatchObject({ lastOk: false, lastError: 'Сервер ответил HTTP 500' });

    // Проба не выполнялась → check=null; вебхука у IMAP нет.
    const imap = byTitle('Входящая почта (IMAP)');
    expect(imap.check).toBeNull();
    expect(imap.webhook).toBeUndefined();

    // Mango: аутентификация подписью — секрет-заголовка нет, есть note.
    const mango = byTitle('Телефония Mango Office');
    expect(mango.webhook).toMatchObject({ headerName: null });
  });
});
