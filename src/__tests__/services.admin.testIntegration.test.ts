import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSettingValue, sendEmail, warn, imapConnect, imapLogout, ImapFlowCtor } = vi.hoisted(() => {
  const imapConnect = vi.fn();
  const imapLogout = vi.fn();
  return {
    getSettingValue: vi.fn(),
    sendEmail: vi.fn(),
    warn: vi.fn(),
    imapConnect,
    imapLogout,
    ImapFlowCtor: vi.fn(() => ({ connect: imapConnect, logout: imapLogout }))
  };
});
vi.mock('@/lib/config/integrationSettings', () => ({ getSettingValue }));
vi.mock('@/lib/email/send', () => ({ send: sendEmail }));
vi.mock('@/lib/logging', () => ({ log: { warn } }));
vi.mock('imapflow', () => ({ ImapFlow: ImapFlowCtor }));

import { testIntegration, INTEGRATION_TEST_KEYS } from '@/lib/services/admin/testIntegration';
import { computeMangoSign } from '@/lib/telephony/mango/sign';
import type { SessionPayload } from '@/lib/auth/jwt';

const ADMIN = { sub: 'admin1', role: 'admin' } as SessionPayload;
const MANAGER = { sub: 'm1', role: 'manager' } as SessionPayload;

function makePrisma() {
  return {
    user: { findUnique: vi.fn() },
    syncState: { upsert: vi.fn().mockResolvedValue({}) }
  };
}
let prisma = makePrisma();

/** getSettingValue отвечает по ключу из карты (нет ключа → null). */
function settings(map: Record<string, string | null>) {
  getSettingValue.mockImplementation((_p: unknown, key: string) => Promise.resolve(map[key] ?? null));
}

function fetchMock() {
  return fetch as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma = makePrisma();
  settings({});
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function run(key: string, session: SessionPayload = ADMIN) {
  return testIntegration(prisma as never, session, key);
}

describe('testIntegration — контракт', () => {
  it('не-admin → forbidden, проба не выполняется', async () => {
    const res = await run('telegram', MANAGER);
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(fetchMock()).not.toHaveBeenCalled();
    expect(prisma.syncState.upsert).not.toHaveBeenCalled();
  });

  it('неизвестный ключ → unknown_key', async () => {
    expect(await run('nope')).toEqual({ ok: false, error: 'unknown_key' });
  });

  it('успешная проба пишет SyncState: lastRunAt=lastSuccessAt, lastError=null', async () => {
    settings({ 'telegram.botToken': 'tok' });
    const res = await run('telegram');
    expect(res).toEqual({ ok: true, success: true, message: 'Подключение успешно' });

    const { where, create, update } = prisma.syncState.upsert.mock.calls[0][0];
    expect(where).toEqual({ entity: 'integration.telegram' });
    expect(create.lastRunAt).toBeInstanceOf(Date);
    expect(create.lastSuccessAt).toEqual(create.lastRunAt);
    expect(create.lastError).toBeNull();
    expect(update.lastSuccessAt).toEqual(update.lastRunAt);
    expect(update.lastError).toBeNull();
  });

  it('провальная проба пишет lastError, lastSuccessAt не обновляется', async () => {
    settings({ 'telegram.botToken': 'tok' });
    fetchMock().mockResolvedValue({ status: 500 });
    const res = await run('telegram');
    expect(res).toEqual({ ok: true, success: false, message: 'Сервер ответил HTTP 500' });

    const { create, update } = prisma.syncState.upsert.mock.calls[0][0];
    expect(create.lastSuccessAt).toBeNull();
    expect(create.lastError).toBe('Сервер ответил HTTP 500');
    expect(update.lastSuccessAt).toBeUndefined();
    expect(update.lastError).toBe('Сервер ответил HTTP 500');
  });

  it('сбой записи SyncState не ломает ответ (log.warn)', async () => {
    settings({ 'telegram.botToken': 'tok' });
    prisma.syncState.upsert.mockRejectedValue(new Error('db down'));
    const res = await run('telegram');
    expect(res).toEqual({ ok: true, success: true, message: 'Подключение успешно' });
    expect(warn).toHaveBeenCalled();
  });

  it('сбой записи SyncState не-Error значением тоже логируется текстом', async () => {
    // Prisma/драйвер может отвергнуть промис строкой, а не Error (так уже было с
    // imap-клиентом ниже). Тогда `err.message` не существует — нужен String(err),
    // иначе в лог уйдёт undefined и разбирать инцидент будет нечем.
    settings({ 'telegram.botToken': 'tok' });
    prisma.syncState.upsert.mockRejectedValue('соединение закрыто');
    const res = await run('telegram');
    expect(res).toEqual({ ok: true, success: true, message: 'Подключение успешно' });
    expect(warn).toHaveBeenCalledWith(
      '[testIntegration] SyncState write failed',
      expect.objectContaining({ error: 'соединение закрыто' })
    );
  });

  it('каждый ключ реестра выполняется без throw', async () => {
    // Всё «не настроено» → пробы возвращают вежливый отказ, не исключение.
    for (const key of INTEGRATION_TEST_KEYS) {
      const res = await run(key);
      expect(res.ok).toBe(true);
    }
  });
});

describe('probe: telegram', () => {
  it('нет токена → не настроено, fetch не зовётся', async () => {
    const res = await run('telegram');
    expect(res).toMatchObject({ ok: true, success: false });
    expect((res as { message: string }).message).toContain('Не заполнены настройки');
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('getMe по токену; 401 → «авторизация отклонена», секрет не утекает в message', async () => {
    settings({ 'telegram.botToken': 'super-secret-token' });
    fetchMock().mockResolvedValue({ status: 401 });
    const res = await run('telegram');
    expect(res).toEqual({ ok: true, success: false, message: 'Авторизация отклонена (HTTP 401)' });
    expect(fetchMock().mock.calls[0][0]).toBe('https://api.telegram.org/botsuper-secret-token/getMe');
    expect((res as { message: string }).message).not.toContain('super-secret-token');
  });

  it('сетевая ошибка → «недоступен», без текста исходной ошибки (может содержать URL с токеном)', async () => {
    settings({ 'telegram.botToken': 'tok' });
    fetchMock().mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.telegram.org/bottok'));
    const res = await run('telegram');
    expect(res).toEqual({
      ok: true,
      success: false,
      message: 'Сервис недоступен: сетевая ошибка или таймаут'
    });
  });
});

describe('probe: max', () => {
  it('дефолтный базовый URL + токен в query (энкодится)', async () => {
    settings({ 'max.botToken': 'a b' });
    await run('max');
    expect(fetchMock().mock.calls[0][0]).toBe('https://botapi.max.ru/me?access_token=a%20b');
  });

  it('кастомный базовый URL со слэшем на конце склеивается без дублей', async () => {
    settings({ 'max.botToken': 't', 'max.baseUrl': 'https://max.example.ru/api/' });
    await run('max');
    expect(fetchMock().mock.calls[0][0]).toBe('https://max.example.ru/api/me?access_token=t');
  });

  it('нет токена → не настроено', async () => {
    const res = await run('max');
    expect(res).toMatchObject({ success: false });
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

describe('probe: whatsapp', () => {
  it('GET v3/channels с Bearer-ключом', async () => {
    settings({ 'whatsapp.apiKey': 'wkey', 'whatsapp.channelId': 'ch1' });
    await run('whatsapp');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('https://api.wazzup24.com/v3/channels');
    expect(init.headers.authorization).toBe('Bearer wkey');
  });

  it('нет ключа или канала → не настроено', async () => {
    settings({ 'whatsapp.apiKey': 'wkey' });
    const res = await run('whatsapp');
    expect(res).toMatchObject({ success: false });
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

describe('probe: imap', () => {
  it('нет host/user/password → не настроено, imapflow не зовётся', async () => {
    settings({ 'imap.host': 'imap.x.ru' });
    const res = await run('imap');
    expect(res).toMatchObject({ success: false });
    expect(ImapFlowCtor).not.toHaveBeenCalled();
  });

  it('connect+logout успешны → успех; порт/TLS из настроек', async () => {
    settings({
      'imap.host': 'imap.x.ru',
      'imap.user': 'u',
      'imap.password': 'p',
      'imap.port': '143',
      'imap.tls': '0'
    });
    imapConnect.mockResolvedValue(undefined);
    imapLogout.mockResolvedValue(undefined);
    const res = await run('imap');
    expect(res).toEqual({ ok: true, success: true, message: 'Подключение успешно' });
    expect(ImapFlowCtor).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'imap.x.ru', port: 143, secure: false, auth: { user: 'u', pass: 'p' } })
    );
  });

  it('дефолты: порт 993, TLS включён (в т.ч. кривой порт)', async () => {
    settings({ 'imap.host': 'h', 'imap.user': 'u', 'imap.password': 'p', 'imap.port': 'abc' });
    imapConnect.mockResolvedValue(undefined);
    imapLogout.mockResolvedValue(undefined);
    await run('imap');
    expect(ImapFlowCtor).toHaveBeenCalledWith(expect.objectContaining({ port: 993, secure: true }));
  });

  it('сбой соединения → первая строка сообщения, без стека', async () => {
    settings({ 'imap.host': 'h', 'imap.user': 'u', 'imap.password': 'p' });
    imapConnect.mockRejectedValue(new Error('Authentication failed\nat stack line'));
    const res = await run('imap');
    expect(res).toEqual({
      ok: true,
      success: false,
      message: 'Не удалось подключиться: Authentication failed'
    });
  });

  it('не-Error сбой → общий текст', async () => {
    settings({ 'imap.host': 'h', 'imap.user': 'u', 'imap.password': 'p' });
    imapConnect.mockRejectedValue('strange');
    const res = await run('imap');
    expect(res).toEqual({
      ok: true,
      success: false,
      message: 'Не удалось подключиться: ошибка соединения'
    });
  });
});

describe('probe: dadata', () => {
  it('POST suggest/party с Token-ключом', async () => {
    settings({ 'dadata.apiKey': 'dk' });
    await run('dadata');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toContain('suggestions.dadata.ru');
    expect(init.headers.authorization).toBe('Token dk');
    expect(JSON.parse(init.body)).toEqual({ query: 'тест', count: 1 });
  });

  it('нет ключа → не настроено', async () => {
    const res = await run('dadata');
    expect(res).toMatchObject({ success: false });
    expect(fetchMock()).not.toHaveBeenCalled();
  });
});

describe('probe: onec', () => {
  it('нет адреса → не настроено', async () => {
    settings({ 'onec.apiToken': 't' });
    const res = await run('onec');
    expect(res).toMatchObject({ success: false });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('склейка apiUrl+healthPath, Bearer-токен (схема rest-wire)', async () => {
    settings({
      'onec.apiUrl': 'https://1c.example.ru/base/hs/exchange/',
      'onec.healthPath': '/health',
      'onec.apiToken': 'onec-token'
    });
    await run('onec');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('https://1c.example.ru/base/hs/exchange/health');
    expect(init.headers.authorization).toBe('Bearer onec-token');
  });

  it('без healthPath — проба самого apiUrl; без токена — без Authorization', async () => {
    settings({ 'onec.apiUrl': 'https://1c.example.ru/api' });
    await run('onec');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('https://1c.example.ru/api');
    expect(init.headers.authorization).toBeUndefined();
  });
});

describe('probe: mango', () => {
  it('нет ключа/соли → не настроено', async () => {
    settings({ 'mango.apiKey': 'k' });
    const res = await run('mango');
    expect(res).toMatchObject({ success: false });
    expect(fetchMock()).not.toHaveBeenCalled();
  });

  it('подписанный POST config/users/request по дефолтному base', async () => {
    settings({ 'mango.apiKey': 'mk', 'mango.apiSalt': 'ms' });
    await run('mango');
    const [url, init] = fetchMock().mock.calls[0];
    expect(url).toBe('https://app.mango-office.ru/vpbx/config/users/request');
    const body = new URLSearchParams(init.body);
    expect(body.get('vpbx_api_key')).toBe('mk');
    expect(body.get('json')).toBe('{}');
    expect(body.get('sign')).toBe(computeMangoSign('mk', '{}', 'ms'));
  });

  it('кастомный base URL склеивается без двойного слэша', async () => {
    settings({ 'mango.apiKey': 'k', 'mango.apiSalt': 's', 'mango.vpbxBaseUrl': 'https://m.example.ru/vpbx/' });
    await run('mango');
    expect(fetchMock().mock.calls[0][0]).toBe('https://m.example.ru/vpbx/config/users/request');
  });
});

describe('probe: email', () => {
  it('нет email у админа → не настроено, письмо не шлётся', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: '  ' });
    const res = await run('email');
    expect(res).toMatchObject({ success: false });
    expect((res as { message: string }).message).toContain('email администратора');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sent → успех с адресом получателя', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'admin@x.ru' });
    sendEmail.mockResolvedValue({ status: 'sent', id: 'e1' });
    const res = await run('email');
    expect(res).toEqual({
      ok: true,
      success: true,
      message: 'Тестовое письмо отправлено на admin@x.ru'
    });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@x.ru' }));
  });

  it('skipped: disabled → подсказка включить; no-api-key → не настроен ключ', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@x.ru' });
    sendEmail.mockResolvedValue({ status: 'skipped', reason: 'disabled' });
    let res = await run('email');
    expect((res as { message: string }).message).toContain('выключена');

    sendEmail.mockResolvedValue({ status: 'skipped', reason: 'no-api-key' });
    res = await run('email');
    expect((res as { message: string }).message).toContain('Resend');
  });

  it('транспорт бросил → «недоступен»', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@x.ru' });
    sendEmail.mockRejectedValue(new Error('resend down'));
    const res = await run('email');
    expect(res).toEqual({
      ok: true,
      success: false,
      message: 'Сервис недоступен: сетевая ошибка или таймаут'
    });
  });
});
