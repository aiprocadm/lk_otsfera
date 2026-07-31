import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';
import { decryptSecret } from '@/lib/crypto/secrets';
import { SETTING_SPECS, type SettingKey } from './integrationSettings';

/**
 * Синхронно читаемый снапшот эффективных значений настроек интеграций
 * (спека 2026-07-22-integration-settings-wave2 §2).
 *
 * Нужен, потому что `NotificationChannel.isEnabledFor` и транспорты
 * мессенджеров синхронные, а источник истины (IntegrationSetting) — в БД.
 * Async-швы (диспетчер уведомлений, воркер-процессоры, страницы настроек)
 * праймят снапшот; синхронные читатели берут значение из него, а до первого
 * prime — из env (то же поведение, что до переноса настроек в БД).
 */

const TTL_MS = 30_000;

let snapshot: Map<SettingKey, string> | null = null;
/** Момент последней попытки prime (успешной или нет) — TTL и backoff. */
let lastAttemptAt = 0;

function envFallback(key: SettingKey): string | null {
  return process.env[SETTING_SPECS[key].envVar]?.trim() || null;
}

/**
 * Загрузка снапшота одним findMany. В снапшот попадают ТОЛЬКО ключи, реально
 * заданные в БД (непустое значение, секрет расшифровался) — остальные всегда
 * читаются из env вживую, поэтому снапшот не «замораживает» env-значения.
 * Fail-open: ошибка БД (нет соединения в unit-контексте, миграция не
 * применена) логируется и ставит backoff — читатели остаются на env-fallback.
 */
export async function primeIntegrationSettingsCache(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  if (now - lastAttemptAt < TTL_MS) return;
  lastAttemptAt = now;

  try {
    const keys = Object.keys(SETTING_SPECS) as SettingKey[];
    const rows = await prisma.integrationSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true, isSecret: true },
    });

    const next = new Map<SettingKey, string>();
    for (const row of rows) {
      if (row.value === null || row.value === '') continue;
      if (row.isSecret) {
        try {
          next.set(row.key as SettingKey, decryptSecret(row.value));
        } catch {
          // Порча/смена мастер-ключа — как в getSettingValue: env-fallback.
        }
      } else {
        next.set(row.key as SettingKey, row.value);
      }
    }
    snapshot = next;
  } catch (err) {
    log.warn('[integration-settings] cache prime failed — env fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Эффективное значение настройки, синхронно: БД-значение из снапшота (если
 * ключ там есть) → живой env-fallback (пустая строка = не задано, как в
 * getSettingValue).
 */
export function cachedIntegrationSetting(key: SettingKey): string | null {
  const v = snapshot?.get(key);
  return v !== undefined ? v : envFallback(key);
}

/** Сброс после сохранения настроек в UI — следующий prime перечитает БД. */
export function resetIntegrationSettingsCache(): void {
  snapshot = null;
  lastAttemptAt = 0;
}
