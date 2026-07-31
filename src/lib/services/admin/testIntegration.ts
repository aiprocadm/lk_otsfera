import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getSettingValue } from '@/lib/config/integrationSettings';
import { computeMangoSign } from '@/lib/telephony/mango/sign';
import { send as sendEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

/**
 * Универсальная «Проверить подключение» (этап 1 ТЗ, ФТ-14.3, спека §5).
 *
 * Принцип: берём то, что задал админ в /admin/integrations (эффективные
 * значения: БД → env-fallback), и дёргаем сервис generic-пробой. Никаких
 * зашитых в код эндпоинтов конкретного сервера — админ подключает интеграцию
 * из профиля без разработчика.
 *
 * Результат пишется в SyncState (entity `integration.<key>`): lastRunAt —
 * каждая проба, lastSuccessAt — успешная, lastError — текст последней ошибки.
 * Секреты в сообщения и SyncState не попадают.
 */

export const INTEGRATION_TEST_KEYS = [
  'email',
  'telegram',
  'max',
  'whatsapp',
  'imap',
  'dadata',
  'onec',
  'mango',
] as const;

export type IntegrationTestKey = (typeof INTEGRATION_TEST_KEYS)[number];

export type IntegrationTestOutcome =
  | { ok: true; success: boolean; message: string }
  | { ok: false; error: 'forbidden' | 'unknown_key' };

type Probe = { ok: boolean; message: string };

const PROBE_TIMEOUT_MS = 5000;

const OK: Probe = { ok: true, message: 'Подключение успешно' };
const NETWORK_FAIL: Probe = {
  ok: false,
  message: 'Сервис недоступен: сетевая ошибка или таймаут',
};

function notConfigured(what: string): Probe {
  return { ok: false, message: `Не заполнены настройки: ${what}` };
}

/** HTTP-статус пробы → человекочитаемый вердикт (без утечки тела/URL). */
function statusToProbe(status: number): Probe {
  if (status >= 200 && status < 300) return OK;
  if (status === 401 || status === 403) {
    return { ok: false, message: `Авторизация отклонена (HTTP ${status})` };
  }
  return { ok: false, message: `Сервер ответил HTTP ${status}` };
}

/** fetch с таймаутом; любая сетевая ошибка → NETWORK_FAIL (текст ошибки может содержать URL с секретом — не показываем). */
async function probeFetch(url: string, init: RequestInit = {}): Promise<Probe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return statusToProbe(res.status);
  } catch {
    return NETWORK_FAIL;
    /* v8 ignore next 2 -- V8 marks the finally as a branch; the exceptional-completion edge is unreachable (bare catch catches all, clearTimeout cannot throw) */
  } finally {
    clearTimeout(timer);
  }
}

/** Склейка базового URL и пути без двойных/пропавших слэшей. */
function joinUrl(base: string, path: string): string {
  if (!path) return base;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function probeEmail(prisma: PrismaClient, session: SessionPayload): Promise<Probe> {
  const admin = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { email: true },
  });
  const to = admin?.email?.trim();
  if (!to) return notConfigured('email администратора (некуда отправить тестовое письмо)');

  try {
    const result = await sendEmail({
      to,
      subject: 'Проверка подключения — ЛК ОЦ Сфера',
      html: '<p>Это тестовое письмо: отправка почты из личного кабинета работает.</p>',
      text: 'Это тестовое письмо: отправка почты из личного кабинета работает.',
    });
    if (result.status === 'sent') {
      return { ok: true, message: `Тестовое письмо отправлено на ${to}` };
    }
    if (result.reason === 'disabled') {
      return { ok: false, message: 'Отправка почты выключена (включите её в настройках выше)' };
    }
    // no-recipient недостижим (to проверен выше) → остаётся no-api-key.
    return notConfigured('API-ключ Resend');
  } catch {
    return NETWORK_FAIL;
  }
}

async function probeTelegram(prisma: PrismaClient): Promise<Probe> {
  const token = await getSettingValue(prisma, 'telegram.botToken');
  if (!token) return notConfigured('токен бота');
  return probeFetch(`https://api.telegram.org/bot${token}/getMe`);
}

async function probeMax(prisma: PrismaClient): Promise<Probe> {
  const token = await getSettingValue(prisma, 'max.botToken');
  if (!token) return notConfigured('токен бота');
  const base = (await getSettingValue(prisma, 'max.baseUrl')) || 'https://botapi.max.ru';
  return probeFetch(`${joinUrl(base, 'me')}?access_token=${encodeURIComponent(token)}`);
}

async function probeWhatsapp(prisma: PrismaClient): Promise<Probe> {
  const apiKey = await getSettingValue(prisma, 'whatsapp.apiKey');
  const channelId = await getSettingValue(prisma, 'whatsapp.channelId');
  if (!apiKey || !channelId) return notConfigured('API-ключ и ID канала агрегатора');
  const base = (await getSettingValue(prisma, 'whatsapp.baseUrl')) || 'https://api.wazzup24.com';
  return probeFetch(joinUrl(base, 'v3/channels'), {
    headers: { authorization: `Bearer ${apiKey}` },
  });
}

async function probeImap(prisma: PrismaClient): Promise<Probe> {
  const host = await getSettingValue(prisma, 'imap.host');
  const user = await getSettingValue(prisma, 'imap.user');
  const password = await getSettingValue(prisma, 'imap.password');
  if (!host || !user || !password) return notConfigured('сервер, логин и пароль IMAP');

  const rawPort = (await getSettingValue(prisma, 'imap.port'))?.trim();
  const port = rawPort && /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 993;
  const rawTls = ((await getSettingValue(prisma, 'imap.tls')) ?? '1').trim().toLowerCase();
  const secure = rawTls !== '0' && rawTls !== 'false' && rawTls !== 'off';

  try {
    // Dynamic import: клиент тяжёлый и нужен только пробе (poll-адаптер — stub).
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({
      host,
      port,
      secure,
      auth: { user, pass: password },
      logger: false,
      greetingTimeout: PROBE_TIMEOUT_MS,
      socketTimeout: PROBE_TIMEOUT_MS,
    });
    await client.connect();
    await client.logout();
    return OK;
  } catch (err) {
    // Сообщение ImapFlow не содержит пароль (host/логин — не секрет), но
    // режем до первой строки, чтобы не тащить стек в UI/SyncState.
    const raw = err instanceof Error ? err.message.split('\n')[0]! : 'ошибка соединения';
    return { ok: false, message: `Не удалось подключиться: ${raw}` };
  }
}

async function probeDadata(prisma: PrismaClient): Promise<Probe> {
  const apiKey = await getSettingValue(prisma, 'dadata.apiKey');
  if (!apiKey) return notConfigured('API-ключ DaData');
  return probeFetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Token ${apiKey}`,
    },
    body: JSON.stringify({ query: 'тест', count: 1 }),
  });
}

async function probeOnec(prisma: PrismaClient): Promise<Probe> {
  const apiUrl = await getSettingValue(prisma, 'onec.apiUrl');
  if (!apiUrl) return notConfigured('адрес API 1С');
  const healthPath = (await getSettingValue(prisma, 'onec.healthPath')) ?? '';
  const token = await getSettingValue(prisma, 'onec.apiToken');
  // Та же схема авторизации, что у боевого REST-адаптера (rest-wire.buildAuthHeader).
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return probeFetch(joinUrl(apiUrl, healthPath), { headers });
}

async function probeMango(prisma: PrismaClient): Promise<Probe> {
  const apiKey = await getSettingValue(prisma, 'mango.apiKey');
  const salt = await getSettingValue(prisma, 'mango.apiSalt');
  if (!apiKey || !salt) return notConfigured('API-ключ и соль подписи');
  const base =
    (await getSettingValue(prisma, 'mango.vpbxBaseUrl')) || 'https://app.mango-office.ru/vpbx/';

  // Generic-проба доступности: подписанный запрос читающей команды VPBX API.
  // Успех = достучались и авторизация принята; живой обмен звонками — отдельный модуль.
  const json = '{}';
  const sign = computeMangoSign(apiKey, json, salt);
  const body = new URLSearchParams({ vpbx_api_key: apiKey, sign, json });
  return probeFetch(joinUrl(base, 'config/users/request'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

function isTestKey(key: string): key is IntegrationTestKey {
  return (INTEGRATION_TEST_KEYS as readonly string[]).includes(key);
}

async function runProbe(
  prisma: PrismaClient,
  session: SessionPayload,
  key: IntegrationTestKey
): Promise<Probe> {
  switch (key) {
    case 'email':
      return probeEmail(prisma, session);
    case 'telegram':
      return probeTelegram(prisma);
    case 'max':
      return probeMax(prisma);
    case 'whatsapp':
      return probeWhatsapp(prisma);
    case 'imap':
      return probeImap(prisma);
    case 'dadata':
      return probeDadata(prisma);
    case 'onec':
      return probeOnec(prisma);
    case 'mango':
      return probeMango(prisma);
  }
}

/**
 * Проба подключения + запись результата в SyncState. Сбой записи не ломает
 * ответ админу (§3 degrade gracefully): вердикт пробы важнее диагностики.
 */
export async function testIntegration(
  prisma: PrismaClient,
  session: SessionPayload,
  key: string
): Promise<IntegrationTestOutcome> {
  if (session.role !== 'admin') return { ok: false, error: 'forbidden' };
  if (!isTestKey(key)) return { ok: false, error: 'unknown_key' };

  const probe = await runProbe(prisma, session, key);

  const entity = `integration.${key}`;
  const now = new Date();
  try {
    await prisma.syncState.upsert({
      where: { entity },
      create: {
        entity,
        lastRunAt: now,
        lastSuccessAt: probe.ok ? now : null,
        lastError: probe.ok ? null : probe.message,
      },
      update: {
        lastRunAt: now,
        ...(probe.ok ? { lastSuccessAt: now, lastError: null } : { lastError: probe.message }),
      },
    });
  } catch (err) {
    log.warn('[testIntegration] SyncState write failed', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, success: probe.ok, message: probe.message };
}
