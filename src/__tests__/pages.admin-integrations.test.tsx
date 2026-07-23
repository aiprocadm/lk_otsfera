// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

const { getIntegrationsStatus } = vi.hoisted(() => ({ getIntegrationsStatus: vi.fn() }));
vi.mock('@/lib/services/admin/integrations', () => ({ getIntegrationsStatus }));

const { getSettingsView } = vi.hoisted(() => ({ getSettingsView: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingsView }));

const { primeIntegrationSettingsCache } = vi.hoisted(() => ({
  primeIntegrationSettingsCache: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('@/lib/config/integrationSettingsCache', () => ({ primeIntegrationSettingsCache }));

// Client-компоненты форм — заглушки (SSR-тест страницы их не драйвит).
vi.mock('@/components/admin/email-settings-form', () => ({
  EmailSettingsForm: () => null
}));
const { formTitles } = vi.hoisted(() => ({ formTitles: [] as string[] }));
vi.mock('@/components/admin/integration-settings-form', () => ({
  IntegrationSettingsForm: ({ title }: { title: string }) => {
    formTitles.push(title);
    return null;
  }
}));
vi.mock('@/server-actions/admin/integrationSettings', () => ({
  saveTelegramSettingsAction: vi.fn(),
  saveMaxSettingsAction: vi.fn(),
  saveWhatsappSettingsAction: vi.fn(),
  saveMangoSettingsAction: vi.fn(),
  saveImapSettingsAction: vi.fn(),
  saveOnecSettingsAction: vi.fn(),
  saveDadataSettingsAction: vi.fn()
}));

import AdminIntegrationsPage from '@/app/admin/integrations/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

const VIEW_KEYS = [
  'email.enabled',
  'email.from',
  'email.resendApiKey',
  'telegram.botToken',
  'telegram.botUsername',
  'max.botToken',
  'max.botUsername',
  'max.baseUrl',
  'whatsapp.apiKey',
  'whatsapp.channelId',
  'whatsapp.baseUrl',
  'mango.apiKey',
  'mango.apiSalt',
  'mango.vpbxBaseUrl',
  'imap.adapter',
  'imap.host',
  'imap.port',
  'imap.user',
  'imap.password',
  'imap.tls',
  'onec.adapter',
  'onec.apiUrl',
  'onec.apiToken',
  'onec.healthPath',
  'dadata.enabled',
  'dadata.apiKey'
];

describe('AdminIntegrationsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    getIntegrationsStatus.mockReset();
    getSettingsView.mockReset();
    primeIntegrationSettingsCache.mockClear();
    formTitles.length = 0;
    requireAdmin.mockResolvedValue(SESSION);
    getSettingsView.mockResolvedValue(
      VIEW_KEYS.map((key) => ({
        key,
        isSecret: key.endsWith('Key') || key.endsWith('Token') || key.endsWith('password'),
        isSet: false,
        value: null,
        source: 'none'
      }))
    );
  });

  it('requires admin and renders the security notice + rows with status badges', async () => {
    getIntegrationsStatus.mockReturnValue([
      { key: 'mango', label: 'Телефония (Mango Office)', enabled: true, description: 'desc-mango', envHint: 'HINT_MANGO' },
      { key: 'telegram', label: 'Telegram-бот', enabled: false, description: 'desc-tg', envHint: 'HINT_TG' }
    ]);

    const { container } = await renderServerComponent(AdminIntegrationsPage());

    expect(requireAdmin).toHaveBeenCalled();
    // Статус-панель читает кэш настроек — страница обязана его праймить.
    expect(primeIntegrationSettingsCache).toHaveBeenCalled();
    const text = container.textContent ?? '';
    // security notice: секреты в БД зашифрованы, env — запасной вариант
    expect(text).toContain('Секретные ключи хранятся в базе в зашифрованном виде');
    // both rows + both badge states
    expect(text).toContain('Телефония (Mango Office)');
    expect(text).toContain('Подключено');
    expect(text).toContain('Telegram-бот');
    expect(text).toContain('Не настроено');
    // env hints are shown (they are names, not secret values)
    expect(text).toContain('HINT_MANGO');
    // все группы настроек смонтированы
    expect(formTitles).toEqual([
      'Telegram-бот',
      'Max-бот',
      'WhatsApp (агрегатор)',
      'Телефония Mango Office',
      'Входящая почта (IMAP)',
      'Обмен с 1С',
      'DaData (подсказки по ИНН)'
    ]);
  });
});
