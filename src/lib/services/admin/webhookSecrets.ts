import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { getSettingValue, saveSettings, type SettingKey } from '@/lib/config/integrationSettings';
import { getAppBaseUrl } from '@/lib/notifications/shared';
import { log } from '@/lib/logging';

/**
 * Секреты вебхуков мессенджеров (`У-123`).
 *
 * Секрет вебхука жил только в переменной сервера: подключить бота без доступа
 * к серверу было нельзя, а «ключ ввести можно, а включить нельзя, пока
 * программист не зайдёт на сервер» — прямо названный в §0.3 ТЗ дефект
 * приёмки.
 *
 * Здесь два действия: **сгенерировать** секрет (мы его придумываем сами, и
 * потому можем показать один раз) и **зарегистрировать** вебхук у провайдера
 * там, где у него есть на это API.
 *
 * Секрет Mango (`apiSalt`) сюда НЕ входит: его выдаёт провайдер, придумать его
 * на своей стороне нельзя.
 */

/** Провайдеры, у которых секрет вебхука генерируем мы. */
export const WEBHOOK_PROVIDERS = {
  telegram: {
    settingKey: 'telegram.webhookSecret' as SettingKey,
    label: 'Telegram',
    /** Есть ли у провайдера API регистрации вебхука. */
    canRegister: true,
  },
  max: {
    settingKey: 'max.webhookSecret' as SettingKey,
    label: 'Max',
    canRegister: true,
  },
  whatsapp: {
    settingKey: 'whatsapp.webhookSecret' as SettingKey,
    label: 'WhatsApp',
    // У агрегатора адрес вебхука задаётся в его личном кабинете, API для этого
    // нет. Кнопку «Зарегистрировать» показывать нельзя: она не сработала бы, а
    // человек решил бы, что всё готово.
    canRegister: false,
  },
} as const;

export type WebhookProvider = keyof typeof WEBHOOK_PROVIDERS;

export function isWebhookProvider(value: string): value is WebhookProvider {
  // `hasOwn`, а не `in`: `'__proto__' in obj` истинно у любого объекта, и
  // проверка «известный ли провайдер» пропускала бы строку из формы.
  return Object.hasOwn(WEBHOOK_PROVIDERS, value);
}

/** Адрес, который регистрируют у провайдера. */
export function webhookUrlFor(provider: WebhookProvider): string {
  return `${getAppBaseUrl()}/api/integrations/${provider}/webhook`;
}

export type GenerateSecretResult =
  | { ok: true; secret: string }
  | { ok: false; error: 'secrets_key_missing' | 'validation' };

/**
 * Сгенерировать и сохранить новый секрет вебхука.
 *
 * Значение возвращается **один раз** — дальше оно хранится зашифрованным, и
 * прочитать его через форму нельзя. Поэтому вызывающий обязан показать его
 * человеку сразу; второго шанса не будет, только перегенерация.
 *
 * 32 байта в hex: длиннее заголовка Telegram (там предел 256 символов) быть не
 * может, а короче — незачем.
 */
export async function generateWebhookSecret(
  prisma: PrismaClient,
  actorUserId: string,
  provider: WebhookProvider
): Promise<GenerateSecretResult> {
  const secret = randomBytes(32).toString('hex');
  const res = await saveSettings(prisma, actorUserId, [
    { key: WEBHOOK_PROVIDERS[provider].settingKey, value: secret },
  ]);
  if (!res.ok) return res;
  // Сам секрет в журнал не пишем — только факт (`CLAUDE.md` §12).
  log.info('[webhook-secrets] secret regenerated', { provider });
  return { ok: true, secret };
}

export type RegisterWebhookResult =
  | { ok: true; message: string }
  | { ok: false; error: 'not_supported' | 'no_token' | 'no_secret' | 'provider_error' };

const REGISTER_TIMEOUT_MS = 7000;

/**
 * Зарегистрировать адрес вебхука у провайдера.
 *
 * Отказы намеренно разные: «нет токена», «нет секрета» и «провайдер не принял»
 * — это три разные починки, и сводить их в одно «не получилось» значит
 * заставить человека гадать.
 */
export async function registerWebhook(
  prisma: PrismaClient,
  provider: WebhookProvider
): Promise<RegisterWebhookResult> {
  if (!WEBHOOK_PROVIDERS[provider].canRegister) return { ok: false, error: 'not_supported' };

  const secret = (await getSettingValue(prisma, WEBHOOK_PROVIDERS[provider].settingKey))?.trim();
  if (!secret) return { ok: false, error: 'no_secret' };

  const url = webhookUrlFor(provider);

  if (provider === 'telegram') {
    const token = (await getSettingValue(prisma, 'telegram.botToken'))?.trim();
    if (!token) return { ok: false, error: 'no_token' };
    return callProvider(
      `https://api.telegram.org/bot${token}/setWebhook`,
      { url, secret_token: secret },
      provider
    );
  }

  const token = (await getSettingValue(prisma, 'max.botToken'))?.trim();
  if (!token) return { ok: false, error: 'no_token' };
  const base = (await getSettingValue(prisma, 'max.baseUrl'))?.trim() || 'https://botapi.max.ru';
  return callProvider(`${base}/subscriptions?access_token=${token}`, { url, secret }, provider);
}

async function callProvider(
  endpoint: string,
  body: Record<string, string>,
  provider: WebhookProvider
): Promise<RegisterWebhookResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Тело ответа провайдера может содержать токен из адреса — не логируем.
      log.warn('[webhook-secrets] register failed', { provider, status: res.status });
      return { ok: false, error: 'provider_error' };
    }
    return { ok: true, message: `Вебхук ${WEBHOOK_PROVIDERS[provider].label} зарегистрирован.` };
  } catch (err) {
    log.warn('[webhook-secrets] register threw', {
      provider,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: 'provider_error' };
  } finally {
    clearTimeout(timer);
  }
}
