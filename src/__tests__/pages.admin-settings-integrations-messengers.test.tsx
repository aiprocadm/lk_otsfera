// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { getSettingsView } = vi.hoisted(() => ({ getSettingsView: vi.fn() }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView }));

const { isSecretsKeyConfigured } = vi.hoisted(() => ({ isSecretsKeyConfigured: vi.fn() }));
vi.mock('@/lib/crypto/secrets', () => ({ isSecretsKeyConfigured }));

const { getIntegrationsHealth } = vi.hoisted(() => ({ getIntegrationsHealth: vi.fn() }));
vi.mock('@/lib/services/admin/integrationsHealth', () => ({ getIntegrationsHealth }));

const { loadIntegrationDiagnostics, checkOf, webhookOf } = vi.hoisted(() => ({
  loadIntegrationDiagnostics: vi.fn(),
  checkOf: vi.fn(),
  webhookOf: vi.fn(),
}));
vi.mock('@/lib/services/admin/integrationDiagnostics', () => ({ loadIntegrationDiagnostics }));

const { healthRows } = vi.hoisted(() => ({ healthRows: [] as unknown[] }));
vi.mock('@/components/admin/integrations-health-panel', async () => {
  const R = await import('react');
  return {
    IntegrationsHealthPanel: (props: { rows: unknown[] }) => {
      healthRows.splice(0, healthRows.length, ...props.rows);
      return R.createElement('div', { 'data-testid': 'health-panel' }, 'HEALTH');
    },
  };
});

type FormStubProps = {
  title: string;
  check?: unknown;
  webhook?: unknown;
  fields?: Array<{ name: string; initialValue?: string | boolean; secretSet?: boolean }>;
};
const { formProps } = vi.hoisted(() => ({ formProps: [] as FormStubProps[] }));
vi.mock('@/components/admin/integration-settings-form', () => ({
  IntegrationSettingsForm: (props: FormStubProps) => {
    formProps.push(props);
    return null;
  },
}));
vi.mock('@/server-actions/admin/integrationSettings', () => ({
  saveTelegramSettingsAction: vi.fn(),
  saveMaxSettingsAction: vi.fn(),
  saveWhatsappSettingsAction: vi.fn(),
  testIntegrationAction: vi.fn(),
}));

import AdminMessengersSettingsPage from '@/app/admin/settings/integrations/messengers/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

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
    isSecret: key.endsWith('Token') || key.endsWith('Key') || key.endsWith('Secret'),
    isSet: false,
    value: null,
    source: 'none',
    ...make(key),
  }));
}

/**
 * «Подключение мессенджеров» (спека 2026-09-12 §5.3): гард раздела, три
 * формы с диагностикой, светофор только по мессенджерам, шаги подключения,
 * баннер ключа шифрования.
 */
describe('AdminMessengersSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formProps.length = 0;
    healthRows.length = 0;
    requireSettingsSection.mockResolvedValue(SESSION);
    isSecretsKeyConfigured.mockReturnValue(true);
    getIntegrationsHealth.mockResolvedValue({
      ok: true,
      rows: [
        { key: 'onec', label: 'Обмен с 1С', status: 'ok' },
        { key: 'mango', label: 'Телефония', status: 'ok' },
        { key: 'telegram', label: 'Telegram-бот', status: 'ok' },
        { key: 'max', label: 'MAX-бот', status: 'not_configured' },
        { key: 'whatsapp', label: 'WhatsApp', status: 'not_configured' },
      ],
    });
    checkOf.mockImplementation((key: string) => ({
      lastAt: `t-${key}`,
      lastOk: true,
      lastError: null,
    }));
    webhookOf.mockImplementation((name: string, headerName: string | null, secretSet: boolean) => ({
      url: `https://app.test/api/integrations/${name}/webhook`,
      headerName,
      secretSet,
      lastEventAt: null,
    }));
    loadIntegrationDiagnostics.mockResolvedValue({ checkOf, webhookOf });
    getSettingsView.mockImplementation(async (_prisma: unknown, keys: string[]) =>
      viewFor(keys, (key) => ({
        value: key === 'telegram.botUsername' ? 'otsfera_bot' : null,
        isSet: key === 'telegram.webhookSecret' || key === 'whatsapp.apiKey',
        source: key === 'telegram.botUsername' ? 'db' : 'none',
      }))
    );
  });

  it('гард раздела, шапка, шаги, светофор только по мессенджерам, три формы с диагностикой', async () => {
    const { container } = await renderServerComponent(AdminMessengersSettingsPage());

    expect(requireSettingsSection).toHaveBeenCalledWith('integrations.messengers', 'admin');
    expect(loadIntegrationDiagnostics).toHaveBeenCalledWith({}, ['telegram', 'max', 'whatsapp']);
    const text = container.textContent ?? '';
    expect(text).toContain('Подключение мессенджеров');
    expect(text).toContain('без доступа к серверу');
    expect(text).toContain('Создайте бота у @BotFather');
    expect(text).toContain('Создайте бота в MAX');
    expect(text).toContain('Wazzup-совместимый API');
    expect(
      container.querySelector('a[href="/admin/settings/system/feature-flags"]')
    ).not.toBeNull();

    // Светофор получает только строки мессенджеров — 1С и телефония остаются на обзоре.
    expect(healthRows.map((r) => (r as { key: string }).key)).toEqual([
      'telegram',
      'max',
      'whatsapp',
    ]);

    expect(formProps.map((p) => p.title)).toEqual([
      'Telegram-бот',
      'MAX-бот',
      'WhatsApp (агрегатор)',
    ]);
    const tg = formProps[0]!;
    expect(tg.check).toEqual({ lastAt: 't-telegram', lastOk: true, lastError: null });
    expect(tg.webhook).toMatchObject({
      headerName: 'x-telegram-bot-api-secret-token',
      secretSet: true,
      url: expect.stringContaining('/api/integrations/telegram/webhook'),
    });
    expect(tg.fields?.find((f) => f.name === 'telegram_botUsername')?.initialValue).toBe(
      'otsfera_bot'
    );
    expect(formProps[1]!.webhook).toMatchObject({
      headerName: 'x-max-webhook-secret',
      secretSet: false,
    });
    expect(formProps[2]!.webhook).toMatchObject({
      headerName: 'x-wazzup-secret',
      secretSet: false,
    });
    expect(formProps[2]!.fields?.find((f) => f.name === 'whatsapp_apiKey')?.secretSet).toBe(true);
    expect(webhookOf).toHaveBeenCalledTimes(3);
    // Ключ шифрования на месте — предупреждения нет.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('нет ключа шифрования — предупреждение до форм; отказ светофора — понятный текст', async () => {
    isSecretsKeyConfigured.mockReturnValue(false);
    getIntegrationsHealth.mockResolvedValue({ ok: false, error: 'forbidden' });
    const { container } = await renderServerComponent(AdminMessengersSettingsPage());
    const alerts = [...container.querySelectorAll('[role="alert"]')].map(
      (n) => n.textContent ?? ''
    );
    expect(alerts.join(' | ')).toContain('Сохранение секретов недоступно');
    expect(alerts.join(' | ')).toContain('Недостаточно прав');
    expect(container.querySelector('[data-testid="health-panel"]')).toBeNull();
    // Формы всё равно смонтированы: несекретные поля сохранить можно.
    expect(formProps).toHaveLength(3);
  });
});
