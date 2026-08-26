import { beforeEach, describe, expect, it, vi } from 'vitest';

const { saveSettings, getSettingValue } = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  getSettingValue: vi.fn(),
}));
vi.mock('@/lib/config/integrationSettings', async (orig) => {
  const actual = await orig<typeof import('@/lib/config/integrationSettings')>();
  return { ...actual, saveSettings, getSettingValue };
});
vi.mock('@/lib/notifications/shared', () => ({ getAppBaseUrl: () => 'https://lk.example' }));

import {
  generateWebhookSecret,
  isWebhookProvider,
  registerWebhook,
  webhookUrlFor,
} from '@/lib/services/admin/webhookSecrets';

const prisma = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  saveSettings.mockResolvedValue({ ok: true });
});

describe('webhookUrlFor / isWebhookProvider (У-123)', () => {
  it('адрес собирается из базового адреса приложения', () => {
    expect(webhookUrlFor('telegram')).toBe('https://lk.example/api/integrations/telegram/webhook');
  });

  it('чужая строка провайдером не считается', () => {
    expect(isWebhookProvider('telegram')).toBe(true);
    expect(isWebhookProvider('mango')).toBe(false);
    expect(isWebhookProvider('__proto__')).toBe(false);
  });
});

describe('generateWebhookSecret (У-123)', () => {
  it('сохраняет секрет и возвращает его ОДИН раз', async () => {
    const r = await generateWebhookSecret(prisma, 'u1', 'telegram');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 32 байта в hex: длиннее предела заголовка Telegram быть не может.
    expect(r.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(saveSettings).toHaveBeenCalledWith(prisma, 'u1', [
      { key: 'telegram.webhookSecret', value: r.secret },
    ]);
  });

  it('два вызова дают разные секреты', async () => {
    const a = await generateWebhookSecret(prisma, 'u1', 'max');
    const b = await generateWebhookSecret(prisma, 'u1', 'max');
    expect(a.ok && b.ok && a.secret !== b.secret).toBe(true);
  });

  it('без ключа шифрования секрет не выдаётся вовсе', async () => {
    // Иначе человек скопировал бы значение, которого нет в базе.
    saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });
    expect(await generateWebhookSecret(prisma, 'u1', 'telegram')).toEqual({
      ok: false,
      error: 'secrets_key_missing',
    });
  });
});

describe('registerWebhook (У-123)', () => {
  it('провайдер без API регистрации отвечает отдельным кодом, а не «ошибкой»', async () => {
    // Три разные причины — три разные починки; сводить их в одно «не вышло»
    // значит заставить человека гадать.
    expect(await registerWebhook(prisma, 'whatsapp')).toEqual({
      ok: false,
      error: 'not_supported',
    });
    expect(getSettingValue).not.toHaveBeenCalled();
  });

  it('без секрета не ходит к провайдеру', async () => {
    getSettingValue.mockResolvedValue(null);
    expect(await registerWebhook(prisma, 'telegram')).toEqual({ ok: false, error: 'no_secret' });
  });

  it('без токена бота не ходит к провайдеру', async () => {
    getSettingValue.mockImplementation((_p: unknown, key: string) =>
      Promise.resolve(key === 'telegram.webhookSecret' ? 'sec' : null)
    );
    expect(await registerWebhook(prisma, 'telegram')).toEqual({ ok: false, error: 'no_token' });
  });

  it('Telegram: зовёт setWebhook с адресом и секретом', async () => {
    getSettingValue.mockImplementation((_p: unknown, key: string) =>
      Promise.resolve(key === 'telegram.webhookSecret' ? 'sec' : 'tok')
    );
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const r = await registerWebhook(prisma, 'telegram');
    expect(r.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bottok/setWebhook');
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://lk.example/api/integrations/telegram/webhook',
      secret_token: 'sec',
    });
  });

  it('Max: без своего базового адреса берёт умолчание провайдера', async () => {
    getSettingValue.mockImplementation((_p: unknown, key: string) => {
      if (key === 'max.webhookSecret') return Promise.resolve('sec');
      if (key === 'max.botToken') return Promise.resolve('tok');
      return Promise.resolve('');
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await registerWebhook(prisma, 'max');
    expect(fetchMock.mock.calls[0]![0]).toBe('https://botapi.max.ru/subscriptions?access_token=tok');
  });

  it('отказ провайдера — provider_error, а не падение', async () => {
    getSettingValue.mockResolvedValue('x');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await registerWebhook(prisma, 'telegram')).toEqual({
      ok: false,
      error: 'provider_error',
    });
  });

  it('обрыв сети тоже не роняет действие', async () => {
    getSettingValue.mockResolvedValue('x');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    expect(await registerWebhook(prisma, 'telegram')).toEqual({
      ok: false,
      error: 'provider_error',
    });
  });
});
