import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';
import { encryptSecret, decryptSecret, isSecretsKeyConfigured } from '@/lib/crypto/secrets';

/**
 * Реестр настроек интеграций и доступ к их «эффективным» значениям.
 *
 * Источник истины — таблица IntegrationSetting (редактируется в UI). Если ключа
 * там нет, значение берётся из env-переменной (fallback) — так ничего не ломается
 * на переходном периоде и в окружениях, где всё ещё задаётся через env.
 *
 * Секреты (isSecret) в БД зашифрованы; наружу (в форму) их значение НЕ отдаётся —
 * только факт «задан/не задан». В env fallback секрет читается как есть.
 */

export type SettingSpec = {
  key: string;
  /** env-переменная, откуда брать значение, если в БД ключа нет. */
  /**
   * Имя переменной окружения — источник запасного значения.
   *
   * `null` означает «переменной нет и не было»: настройка появилась сразу как
   * настройка (`У-126`: список получателей ops-оповещений). Заводить ей
   * выдуманное имя переменной значило бы соврать реестру и сбить стражи
   * `У-122`/`У-134`, которые сверяют реестр с `.env.example`.
   */
  envVar: string | null;
  isSecret: boolean;
};

// Полный реестр. Группы соответствуют разделам формы интеграций.
export const SETTING_SPECS = {
  // Почта исходящая
  'email.enabled': { key: 'email.enabled', envVar: 'EMAIL_ENABLED', isSecret: false },
  'email.resendApiKey': { key: 'email.resendApiKey', envVar: 'RESEND_API_KEY', isSecret: true },
  'email.from': { key: 'email.from', envVar: 'EMAIL_FROM', isSecret: false },
  // Почта входящая (IMAP)
  'imap.adapter': { key: 'imap.adapter', envVar: 'INBOUND_EMAIL_ADAPTER', isSecret: false },
  'imap.host': { key: 'imap.host', envVar: 'IMAP_HOST', isSecret: false },
  'imap.port': { key: 'imap.port', envVar: 'IMAP_PORT', isSecret: false },
  'imap.user': { key: 'imap.user', envVar: 'IMAP_USER', isSecret: false },
  'imap.password': { key: 'imap.password', envVar: 'IMAP_PASSWORD', isSecret: true },
  'imap.tls': { key: 'imap.tls', envVar: 'IMAP_TLS', isSecret: false },
  // Телефония Mango. Само включение — флаг `telephony_mango`; с `У-124` он
  // поведенческий и переключается в разделе «Функции платформы», а не на
  // сервере (прежний комментарий про edge-middleware больше не действует —
  // флаг снят с `FEATURE_PREFIXES`).
  'mango.apiKey': { key: 'mango.apiKey', envVar: 'MANGO_API_KEY', isSecret: true },
  // `apiSalt` выдаёт провайдер — сгенерировать его на нашей стороне нельзя
  // (в отличие от секретов вебхуков `У-123`).
  'mango.apiSalt': { key: 'mango.apiSalt', envVar: 'MANGO_API_SALT', isSecret: true },
  'mango.vpbxBaseUrl': { key: 'mango.vpbxBaseUrl', envVar: 'MANGO_VPBX_BASE_URL', isSecret: false },
  // `У-124`: адаптер, список разрешённых адресов и задержка поллинга — поля
  // формы, а не переменные сервера.
  'mango.adapter': { key: 'mango.adapter', envVar: 'MANGO_ADAPTER', isSecret: false },
  'mango.allowedIps': { key: 'mango.allowedIps', envVar: 'MANGO_ALLOWED_IPS', isSecret: false },
  'mango.statsPollDelayMs': {
    key: 'mango.statsPollDelayMs',
    envVar: 'MANGO_STATS_POLL_DELAY_MS',
    isSecret: false,
  },
  // Telegram
  'telegram.botToken': { key: 'telegram.botToken', envVar: 'TELEGRAM_BOT_TOKEN', isSecret: true },
  // `У-123`: секрет вебхука генерируется в интерфейсе и сверяется роутом
  // через `getSettingValue`. Раньше он жил только в переменной сервера, и
  // подключить бота без доступа к серверу было нельзя.
  'telegram.webhookSecret': {
    key: 'telegram.webhookSecret',
    envVar: 'TELEGRAM_WEBHOOK_SECRET',
    isSecret: true,
  },
  'telegram.botUsername': {
    key: 'telegram.botUsername',
    envVar: 'TELEGRAM_BOT_USERNAME',
    isSecret: false,
  },
  // Max
  'max.botToken': { key: 'max.botToken', envVar: 'MAX_BOT_TOKEN', isSecret: true },
  'max.botUsername': { key: 'max.botUsername', envVar: 'MAX_BOT_USERNAME', isSecret: false },
  'max.baseUrl': { key: 'max.baseUrl', envVar: 'MAX_API_BASE_URL', isSecret: false },
  // `У-123`: то же, что у Telegram.
  'max.webhookSecret': { key: 'max.webhookSecret', envVar: 'MAX_WEBHOOK_SECRET', isSecret: true },
  // WhatsApp
  'whatsapp.apiKey': {
    key: 'whatsapp.apiKey',
    envVar: 'WHATSAPP_AGGREGATOR_API_KEY',
    isSecret: true,
  },
  'whatsapp.channelId': {
    key: 'whatsapp.channelId',
    envVar: 'WHATSAPP_AGGREGATOR_CHANNEL_ID',
    // `У-131` (дефект `Д-35`): идентификатор канала — не секрет, а адрес.
    // Пока он был помечен секретом, форма его не показывала, и человек не
    // мог проверить, тот ли канал подключён.
    isSecret: false,
  },
  'whatsapp.baseUrl': {
    key: 'whatsapp.baseUrl',
    envVar: 'WHATSAPP_AGGREGATOR_BASE_URL',
    isSecret: false,
  },
  // `У-123`: то же, что у Telegram.
  'whatsapp.webhookSecret': {
    key: 'whatsapp.webhookSecret',
    envVar: 'WHATSAPP_WEBHOOK_SECRET',
    isSecret: true,
  },
  // Обмен с 1С. Выбор адаптера (fake|rest), адрес API, токен и опциональный
  // путь для проверки связи — всё настраивается в UI (env — fallback).
  'onec.adapter': { key: 'onec.adapter', envVar: 'ONE_C_ADAPTER', isSecret: false },
  'onec.apiUrl': { key: 'onec.apiUrl', envVar: 'ONE_C_API_URL', isSecret: false },
  'onec.apiToken': { key: 'onec.apiToken', envVar: 'ONE_C_API_TOKEN', isSecret: true },
  'onec.healthPath': { key: 'onec.healthPath', envVar: 'ONE_C_HEALTH_PATH', isSecret: false },
  // `У-125`: параметры обмена — форма «Автообмен → Параметры», только
  // администратор (это подключение всей платформы, решение `Р-22`).
  'onec.mode': { key: 'onec.mode', envVar: 'ONE_C_MODE', isSecret: false },
  'onec.httpTimeoutMs': {
    key: 'onec.httpTimeoutMs',
    envVar: 'ONE_C_HTTP_TIMEOUT_MS',
    isSecret: false,
  },
  'onec.cursorOverlapMinutes': {
    key: 'onec.cursorOverlapMinutes',
    envVar: 'ONE_C_CURSOR_OVERLAP_MINUTES',
    isSecret: false,
  },
  // Компания по умолчанию для сетевого синка: выбор из списка вместо ручного
  // идентификатора в переменной сервера.
  'onec.defaultCompanyId': {
    key: 'onec.defaultCompanyId',
    envVar: 'ONE_C_COMPANY_ID',
    isSecret: false,
  },
  'onec.pendingMaxAttempts': {
    key: 'onec.pendingMaxAttempts',
    envVar: 'ONE_C_PENDING_MAX_ATTEMPTS',
    isSecret: false,
  },
  'onec.pendingMaxAgeDays': {
    key: 'onec.pendingMaxAgeDays',
    envVar: 'ONE_C_PENDING_MAX_AGE_DAYS',
    isSecret: false,
  },
  // DaData (подсказки по ИНН). Включение + ключ; сам ключ на клиент не уходит.
  // `У-126`: ops-оповещения — пороги и канал доставки. Раньше правились только
  // в конфиге сервера: чтобы перестать получать ложные алерты, требовалась
  // выкладка.
  'alerts.queueWaitingMax': {
    key: 'alerts.queueWaitingMax',
    envVar: 'ALERT_QUEUE_WAITING_MAX',
    isSecret: false,
  },
  'alerts.dlqMax': { key: 'alerts.dlqMax', envVar: 'ALERT_DLQ_MAX', isSecret: false },
  'alerts.syncLagMaxHours': {
    key: 'alerts.syncLagMaxHours',
    envVar: 'ALERT_SYNC_LAG_MAX_HOURS',
    isSecret: false,
  },
  'alerts.renotifyCooldownHours': {
    key: 'alerts.renotifyCooldownHours',
    envVar: 'ALERT_RENOTIFY_COOLDOWN_HOURS',
    isSecret: false,
  },
  'alerts.oneCDeadLetterMax': {
    key: 'alerts.oneCDeadLetterMax',
    envVar: 'ALERT_ONEC_DEADLETTER_MAX',
    isSecret: false,
  },
  // `У-174`: сколько документов со статусом «не выгружен» терпимо, прежде чем
  // светофор 1С пожелтеет и уйдёт оповещение.
  'alerts.oneCPushFailedMax': {
    key: 'alerts.oneCPushFailedMax',
    envVar: 'ALERT_ONEC_PUSH_FAILED_MAX',
    isSecret: false,
  },
  'alerts.telegramBotToken': {
    key: 'alerts.telegramBotToken',
    envVar: 'ALERT_TELEGRAM_BOT_TOKEN',
    isSecret: true,
  },
  'alerts.telegramChatId': {
    key: 'alerts.telegramChatId',
    envVar: 'ALERT_TELEGRAM_CHAT_ID',
    isSecret: false,
  },
  // Переменной окружения у списка получателей НЕТ и не было: до `У-126`
  // оповещения уходили всем администраторам без возможности это изменить.
  // Пустой список сохраняет прежнее поведение.
  'alerts.emailRecipients': { key: 'alerts.emailRecipients', envVar: null, isSecret: false },
  // `У-129`: политики входа. Часть из них была КОНСТАНТАМИ в коде — у таких
  // переменной окружения нет и не было (`envVar: null`).
  'login.twoFactorCodeTtlMinutes': {
    key: 'login.twoFactorCodeTtlMinutes',
    envVar: null,
    isSecret: false,
  },
  'login.twoFactorMaxAttempts': {
    key: 'login.twoFactorMaxAttempts',
    envVar: null,
    isSecret: false,
  },
  'login.backupCodesCount': { key: 'login.backupCodesCount', envVar: null, isSecret: false },
  'login.rateLimitWindowMs': {
    key: 'login.rateLimitWindowMs',
    envVar: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    isSecret: false,
  },
  'login.rateLimitMax': {
    key: 'login.rateLimitMax',
    envVar: 'LOGIN_RATE_LIMIT_MAX',
    isSecret: false,
  },
  'login.inviteTtlDays': {
    key: 'login.inviteTtlDays',
    envVar: 'INVITE_TOKEN_TTL_DAYS',
    isSecret: false,
  },
  'login.resetTtlHours': {
    key: 'login.resetTtlHours',
    envVar: 'RESET_TOKEN_TTL_HOURS',
    isSecret: false,
  },
  'dadata.enabled': { key: 'dadata.enabled', envVar: 'DADATA_ENABLED', isSecret: false },
  'dadata.apiKey': { key: 'dadata.apiKey', envVar: 'DADATA_API_KEY', isSecret: true },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTING_SPECS;

function specOf(key: SettingKey): SettingSpec {
  return SETTING_SPECS[key];
}

/**
 * Эффективное значение настройки: БД (расшифровка секретов) → env fallback → null.
 * Пустая строка трактуется как «не задано» и уходит в fallback.
 */
export async function getSettingValue(
  prisma: PrismaClient,
  key: SettingKey
): Promise<string | null> {
  const spec = specOf(key);
  const row = await prisma.integrationSetting.findUnique({
    where: { key },
    select: { value: true, isSecret: true },
  });
  if (row && row.value !== null && row.value !== '') {
    if (row.isSecret) {
      try {
        return decryptSecret(row.value);
      } catch {
        // Порча/смена ключа — не роняем вызывающего, уходим в fallback.
        return spec.envVar ? process.env[spec.envVar]?.trim() || null : null;
      }
    }
    return row.value;
  }
  return spec.envVar ? process.env[spec.envVar]?.trim() || null : null;
}

/** Пачкой — эффективные значения нескольких настроек. */
export async function getSettingValues(
  prisma: PrismaClient,
  keys: SettingKey[]
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(
    keys.map(async (k) => {
      out[k] = await getSettingValue(prisma, k);
    })
  );
  return out;
}

/**
 * Открытое значение строки настройки. Строка помнит СВОЙ `isSecret` — тот, с
 * которым её записали. Если настройка потом перестала быть секретной, значение
 * в базе всё равно зашифровано, и читать его как обычный текст нельзя.
 */
function plainValue(row: { value: string | null; isSecret: boolean }): string | null {
  if (row.value === null || row.value === '') return null;
  if (!row.isSecret) return row.value;
  try {
    return decryptSecret(row.value);
  } catch {
    // Порча или смена ключа: показываем «не задано», а не шифротекст.
    return null;
  }
}

export type SettingViewRow = {
  key: SettingKey;
  isSecret: boolean;
  /** Задано ли значение (в БД или env). Для секретов — единственное, что видит форма. */
  isSet: boolean;
  /** Открытое значение — только для несекретных настроек; для секретов всегда null. */
  value: string | null;
  /** Источник эффективного значения — чтобы показать «настроено в env» vs «в базе». */
  source: 'db' | 'env' | 'none';
};

/** Данные для формы: секреты маскируются (только isSet), несекретные — со значением. */
export async function getSettingsView(
  prisma: PrismaClient,
  keys: SettingKey[]
): Promise<SettingViewRow[]> {
  const rows = await prisma.integrationSetting.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, isSecret: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  return keys.map((key) => {
    const spec = specOf(key);
    const dbRow = byKey.get(key);
    const dbSet = !!dbRow && dbRow.value !== null && dbRow.value !== '';
    const envVal = spec.envVar ? process.env[spec.envVar]?.trim() : undefined;
    const envSet = !!envVal;
    const source: 'db' | 'env' | 'none' = dbSet ? 'db' : envSet ? 'env' : 'none';
    return {
      key,
      isSecret: spec.isSecret,
      isSet: dbSet || envSet,
      // Расшифровываем по флагу СТРОКИ, а не спецификации. Настройка может
      // перестать быть секретом (`У-131`: `whatsapp.channelId`), и тогда в базе
      // остаётся строка, записанная зашифрованной. Без этой ветки форма
      // показала бы человеку шифротекст и предложила его «поправить».
      value: spec.isSecret ? null : dbSet ? plainValue(dbRow!) : (envVal ?? null),
      source,
    };
  });
}

export type SaveEntry = {
  key: SettingKey;
  /**
   * Новое значение. Для секретов пустая строка/undefined = «не менять»
   * (форма присылает пустое поле, если админ не вводил новый секрет).
   * Явная очистка секрета — отдельным флагом clear.
   */
  value?: string;
  /** Очистить настройку (удалить строку → вернётся env-fallback). */
  clear?: boolean;
};

export type SaveResult = { ok: true } | { ok: false; error: 'secrets_key_missing' | 'validation' };

/**
 * Сохранение группы настроек. Секреты шифруются; пустой секрет не затирает
 * существующий. Пишет один аудит-рекорд на группу (значения секретов не логируются).
 */
export async function saveSettings(
  prisma: PrismaClient,
  actorUserId: string,
  entries: SaveEntry[]
): Promise<SaveResult> {
  const needsKey = entries.some((e) => !e.clear && e.value && specOf(e.key).isSecret);
  if (needsKey && !isSecretsKeyConfigured()) {
    return { ok: false, error: 'secrets_key_missing' };
  }

  const changedKeys: string[] = [];
  for (const entry of entries) {
    const spec = specOf(entry.key);
    if (entry.clear) {
      await prisma.integrationSetting.deleteMany({ where: { key: entry.key } });
      changedKeys.push(entry.key);
      continue;
    }
    const raw = entry.value;
    // Пустой секрет — оставляем как есть (не затираем сохранённый).
    if (spec.isSecret && (raw === undefined || raw === '')) continue;
    if (raw === undefined) continue;

    const stored = spec.isSecret ? encryptSecret(raw) : raw.trim();
    await prisma.integrationSetting.upsert({
      where: { key: entry.key },
      create: { key: entry.key, value: stored, isSecret: spec.isSecret, updatedBy: actorUserId },
      update: { value: stored, isSecret: spec.isSecret, updatedBy: actorUserId },
    });
    changedKeys.push(entry.key);
  }

  // ФТ-14.5: мутации настроек попадают в AuditLog — только перечень
  // изменённых ключей, БЕЗ значений (среди них секреты).
  if (changedKeys.length > 0) {
    await recordAudit(prisma, {
      userId: actorUserId,
      action: 'integration_settings_updated',
      entity: 'integration_setting',
      entityId: changedKeys.join(','),
      after: { keys: changedKeys }, // только ключи, без значений секретов
    });
  }
  return { ok: true };
}
