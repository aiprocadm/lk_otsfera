import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Настройки интеграций: почта (`У-122`), сброс к значению сервера (`У-131`) и
 * секрет вебхука (`У-123`).
 *
 * Две вещи здесь важнее остальных. **Пустой секрет означает «не менять», а не
 * «стереть»** — иначе каждое сохранение формы обнуляло бы ключ. И **ключ
 * настройки проверяется по реестру через `Object.hasOwn`**, а не через `in`:
 * строка `__proto__` проходит проверку `in` у любого объекта и удалила бы
 * произвольную запись.
 */
const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  saveSettings: vi.fn(),
  resetIntegrationSettingsCache: vi.fn(),
  resetEmailTransportCache: vi.fn(),
  resetInboundEmailAdapter: vi.fn(),
  resetOneCAdapter: vi.fn(),
  resetMangoAdapter: vi.fn(),
  testIntegration: vi.fn(),
  generateWebhookSecret: vi.fn(),
  isWebhookProvider: vi.fn(),
  registerWebhook: vi.fn(),
  checkWebhook: vi.fn(),
  sendSelfTestMessage: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin: mocks.requireAdmin }));
// Частичный мок: реестр настроек берём настоящий — по нему проверяется ключ,
// и подмена реестра проверяла бы выдуманный список вместо живого.
vi.mock('@/lib/config/integrationSettings', async () => ({
  ...(await vi.importActual<typeof import('@/lib/config/integrationSettings')>(
    '@/lib/config/integrationSettings'
  )),
  saveSettings: mocks.saveSettings,
}));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  resetIntegrationSettingsCache: mocks.resetIntegrationSettingsCache,
}));
vi.mock('@/lib/email/transport', () => ({
  resetEmailTransportCache: mocks.resetEmailTransportCache,
}));
vi.mock('@/lib/inbound/email', () => ({
  __resetInboundEmailAdapter: mocks.resetInboundEmailAdapter,
}));
vi.mock('@/lib/services/oneCSync', () => ({ resetOneCAdapter: mocks.resetOneCAdapter }));
vi.mock('@/lib/telephony/mango', () => ({ resetMangoAdapter: mocks.resetMangoAdapter }));
vi.mock('@/lib/services/admin/testIntegration', () => ({
  testIntegration: mocks.testIntegration,
}));
vi.mock('@/lib/services/admin/webhookSecrets', () => ({
  generateWebhookSecret: mocks.generateWebhookSecret,
  isWebhookProvider: mocks.isWebhookProvider,
  registerWebhook: mocks.registerWebhook,
}));
vi.mock('@/lib/services/messengers/selfCheck', () => ({
  checkWebhook: mocks.checkWebhook,
  sendSelfTestMessage: mocks.sendSelfTestMessage,
}));

import {
  saveEmailSettingsAction,
  resetSettingToServerValueAction,
  generateWebhookSecretAction,
  registerWebhookAction,
  sendSelfTestMessageAction,
  checkWebhookAction,
} from '@/server-actions/admin/integrationSettings';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ sub: 'admin-1' });
  mocks.saveSettings.mockResolvedValue({ ok: true });
  mocks.isWebhookProvider.mockReturnValue(true);
  mocks.generateWebhookSecret.mockResolvedValue({ ok: true, secret: 'тайна' });
  mocks.registerWebhook.mockResolvedValue({ ok: true, message: 'Готово' });
});

describe('saveEmailSettingsAction — настройки исходящей почты', () => {
  it.each([
    ['галочка формы', 'on'],
    ['строковое true', 'true'],
  ])('«включено» понимается из %s', async (_name, value) => {
    await saveEmailSettingsAction(fd({ email_enabled: value, email_from: ' a@x.ru ' }));

    const entries = mocks.saveSettings.mock.calls[0]?.[2] as Array<{
      key: string;
      value: string;
    }>;
    expect(entries).toContainEqual({ key: 'email.enabled', value: 'true' });
    // Пробелы по краям адреса срезаются — иначе письма уйдут «с адреса с пробелом».
    expect(entries).toContainEqual({ key: 'email.from', value: 'a@x.ru' });
  });

  it('выключено — так и пишем, а не «пусто»', async () => {
    await saveEmailSettingsAction(fd({ email_from: 'a@x.ru' }));

    const entries = mocks.saveSettings.mock.calls[0]?.[2] as Array<{
      key: string;
      value: string;
    }>;
    expect(entries).toContainEqual({ key: 'email.enabled', value: 'false' });
  });

  it('пустой ключ Resend означает «не менять» — уходит пустая строка', async () => {
    await saveEmailSettingsAction(fd({ email_from: 'a@x.ru' }));

    const entries = mocks.saveSettings.mock.calls[0]?.[2] as Array<{
      key: string;
      value: string;
    }>;
    expect(entries).toContainEqual({ key: 'email.resendApiKey', value: '' });
  });

  it('поле не строка считается пустым', async () => {
    const form = fd({ email_from: 'a@x.ru' });
    form.set('email_resendApiKey', new File(['x'], 'a.txt'));

    await expect(saveEmailSettingsAction(form)).resolves.toEqual({ ok: true });
  });

  it('успех сбрасывает кэш транспорта — новый ключ подхватится без перезапуска', async () => {
    await saveEmailSettingsAction(fd({ email_from: 'a@x.ru' }));

    expect(mocks.resetEmailTransportCache).toHaveBeenCalled();
    expect(mocks.resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('отказ записи кэши не трогает', async () => {
    mocks.saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    const res = await saveEmailSettingsAction(fd({ email_from: 'a@x.ru' }));

    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(mocks.resetEmailTransportCache).not.toHaveBeenCalled();
  });
});

describe('resetSettingToServerValueAction — вернуть значение сервера', () => {
  it('настоящий ключ удаляет строку, и снова действует значение сервера', async () => {
    const res = await resetSettingToServerValueAction('email.from');

    expect(res).toEqual({ ok: true });
    expect(mocks.saveSettings).toHaveBeenCalledWith({}, 'admin-1', [
      { key: 'email.from', clear: true },
    ]);
    expect(mocks.resetIntegrationSettingsCache).toHaveBeenCalled();
  });

  it('придуманный ключ — отказ, в базу ничего не уходит', async () => {
    const res = await resetSettingToServerValueAction('какая-то.строка');

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('`__proto__` не проходит проверку — иначе удалил бы чужую запись', async () => {
    const res = await resetSettingToServerValueAction('__proto__');

    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });

  it('отказ записи возвращается как есть', async () => {
    mocks.saveSettings.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    await expect(resetSettingToServerValueAction('email.from')).resolves.toEqual({
      ok: false,
      error: 'secrets_key_missing',
    });
    expect(mocks.resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });
});

describe('Секрет вебхука', () => {
  it('неизвестный провайдер — отказ', async () => {
    mocks.isWebhookProvider.mockReturnValue(false);

    await expect(generateWebhookSecretAction('голубиная почта')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(mocks.generateWebhookSecret).not.toHaveBeenCalled();
  });

  it('секрет возвращается в ответе — показать его можно только один раз', async () => {
    const res = await generateWebhookSecretAction('telegram');

    expect(res).toEqual({ ok: true, secret: 'тайна' });
    expect(mocks.resetIntegrationSettingsCache).toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('нет ключа шифрования — отказ, кэш не сбрасываем', async () => {
    mocks.generateWebhookSecret.mockResolvedValue({ ok: false, error: 'secrets_key_missing' });

    const res = await generateWebhookSecretAction('telegram');

    expect(res).toEqual({ ok: false, error: 'secrets_key_missing' });
    expect(mocks.resetIntegrationSettingsCache).not.toHaveBeenCalled();
  });

  it('регистрация у неизвестного провайдера — отказ', async () => {
    mocks.isWebhookProvider.mockReturnValue(false);

    await expect(registerWebhookAction('что-то')).resolves.toEqual({
      ok: false,
      error: 'validation',
    });
    expect(mocks.registerWebhook).not.toHaveBeenCalled();
  });

  it('удачная регистрация освежает раздел', async () => {
    const res = await registerWebhookAction('telegram');

    expect(res).toEqual({ ok: true, message: 'Готово' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/settings/integrations');
  });

  it('провайдер не принял адрес — раздел не освежаем', async () => {
    mocks.registerWebhook.mockResolvedValue({ ok: false, error: 'provider_error' });

    const res = await registerWebhookAction('telegram');

    expect(res).toEqual({ ok: false, error: 'provider_error' });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

/**
 * `У-213` — две разные проверки канала: путь **наружу** (наше сообщение дошло
 * до клиента) и путь **внутрь** (провайдер достучался до нас). Их легко
 * перепутать, а лечатся они по-разному: наружу — токен и права бота, внутрь —
 * адрес вебхука и секрет.
 *
 * Канал приходит от кнопки на странице, поэтому проверяется здесь: полагаться
 * на то, что неизвестное значение «всё равно провалится дальше», — значит
 * держать защиту на случайности.
 */
describe('Самопроверка каналов', () => {
  beforeEach(() => {
    mocks.sendSelfTestMessage.mockResolvedValue({ ok: true, detail: 'ушло' });
    mocks.checkWebhook.mockResolvedValue({ ok: true, detail: 'адрес наш' });
  });

  it('проверка наружу зовёт свой сервис', async () => {
    const res = await sendSelfTestMessageAction('telegram', new FormData());

    expect(res).toEqual({ ok: true, detail: 'ушло' });
    expect(mocks.sendSelfTestMessage).toHaveBeenCalledWith({}, { sub: 'admin-1' }, 'telegram');
    expect(mocks.checkWebhook).not.toHaveBeenCalled();
  });

  it('проверка внутрь зовёт свой — и не требует сессии в аргументах', async () => {
    const res = await checkWebhookAction('telegram', new FormData());

    expect(res).toEqual({ ok: true, detail: 'адрес наш' });
    expect(mocks.checkWebhook).toHaveBeenCalledWith('telegram');
    expect(mocks.sendSelfTestMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['наружу', sendSelfTestMessageAction],
    ['внутрь', checkWebhookAction],
  ])('придуманный канал (%s) отсекается сразу', async (_name, action) => {
    const res = await action('голубиная почта', new FormData());

    expect(res).toEqual({ ok: false, error: 'channel_unavailable' });
    expect(mocks.requireAdmin).not.toHaveBeenCalled();
  });
});
