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
  envVar: string;
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
  // Телефония Mango. Включение (FEATURE_TELEPHONY_MANGO) намеренно НЕ здесь:
  // флаг читается в edge-middleware, где БД недоступна — переключатель в БД
  // не смог бы влиять на route-гейт и создавал бы иллюзию управления.
  'mango.apiKey': { key: 'mango.apiKey', envVar: 'MANGO_API_KEY', isSecret: true },
  'mango.apiSalt': { key: 'mango.apiSalt', envVar: 'MANGO_API_SALT', isSecret: true },
  'mango.vpbxBaseUrl': { key: 'mango.vpbxBaseUrl', envVar: 'MANGO_VPBX_BASE_URL', isSecret: false },
  // Telegram
  'telegram.botToken': { key: 'telegram.botToken', envVar: 'TELEGRAM_BOT_TOKEN', isSecret: true },
  'telegram.botUsername': {
    key: 'telegram.botUsername',
    envVar: 'TELEGRAM_BOT_USERNAME',
    isSecret: false,
  },
  // Max
  'max.botToken': { key: 'max.botToken', envVar: 'MAX_BOT_TOKEN', isSecret: true },
  'max.botUsername': { key: 'max.botUsername', envVar: 'MAX_BOT_USERNAME', isSecret: false },
  'max.baseUrl': { key: 'max.baseUrl', envVar: 'MAX_API_BASE_URL', isSecret: false },
  // WhatsApp
  'whatsapp.apiKey': {
    key: 'whatsapp.apiKey',
    envVar: 'WHATSAPP_AGGREGATOR_API_KEY',
    isSecret: true,
  },
  'whatsapp.channelId': {
    key: 'whatsapp.channelId',
    envVar: 'WHATSAPP_AGGREGATOR_CHANNEL_ID',
    isSecret: true,
  },
  'whatsapp.baseUrl': {
    key: 'whatsapp.baseUrl',
    envVar: 'WHATSAPP_AGGREGATOR_BASE_URL',
    isSecret: false,
  },
  // Обмен с 1С. Выбор адаптера (fake|rest), адрес API, токен и опциональный
  // путь для проверки связи — всё настраивается в UI (env — fallback).
  'onec.adapter': { key: 'onec.adapter', envVar: 'ONE_C_ADAPTER', isSecret: false },
  'onec.apiUrl': { key: 'onec.apiUrl', envVar: 'ONE_C_API_URL', isSecret: false },
  'onec.apiToken': { key: 'onec.apiToken', envVar: 'ONE_C_API_TOKEN', isSecret: true },
  'onec.healthPath': { key: 'onec.healthPath', envVar: 'ONE_C_HEALTH_PATH', isSecret: false },
  // DaData (подсказки по ИНН). Включение + ключ; сам ключ на клиент не уходит.
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
        return process.env[spec.envVar]?.trim() || null;
      }
    }
    return row.value;
  }
  return process.env[spec.envVar]?.trim() || null;
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
    const envVal = process.env[spec.envVar]?.trim();
    const envSet = !!envVal;
    const source: 'db' | 'env' | 'none' = dbSet ? 'db' : envSet ? 'env' : 'none';
    return {
      key,
      isSecret: spec.isSecret,
      isSet: dbSet || envSet,
      value: spec.isSecret ? null : dbSet ? dbRow!.value : (envVal ?? null),
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
