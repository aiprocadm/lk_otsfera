import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

/**
 * Пороги ops-оповещений (`У-126`).
 *
 * Раньше читались только из переменных окружения: чтобы перестать получать
 * ложный алерт «очередь длиннее ста задач», требовалась выкладка. Теперь это
 * форма «Здоровье системы → Оповещения», а приоритет прежний — **база →
 * переменная сервера → умолчание**. Переменные из чтения не удалены.
 *
 * Аргумент `env` оставлен: им пользуются тесты, чтобы проверить сам разбор
 * значений, не трогая снапшот настроек.
 */
export type Thresholds = {
  queueWaitingMax: number;
  dlqMax: number;
  syncLagMaxMs: number;
  renotifyCooldownMs: number;
  oneCDeadLetterMax: number;
};

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Значение настройки, затем переменной сервера — первое непустое. */
function configured(
  key: Parameters<typeof cachedIntegrationSetting>[0],
  env: string | undefined
): string | undefined {
  return cachedIntegrationSetting(key) ?? env;
}

export function getThresholds(env: Record<string, string | undefined> = process.env): Thresholds {
  return {
    queueWaitingMax: num(configured('alerts.queueWaitingMax', env.ALERT_QUEUE_WAITING_MAX), 100),
    dlqMax: num(configured('alerts.dlqMax', env.ALERT_DLQ_MAX), 0),
    syncLagMaxMs:
      num(configured('alerts.syncLagMaxHours', env.ALERT_SYNC_LAG_MAX_HOURS), 24) * 3600_000,
    renotifyCooldownMs:
      num(configured('alerts.renotifyCooldownHours', env.ALERT_RENOTIFY_COOLDOWN_HOURS), 6) *
      3600_000,
    oneCDeadLetterMax: num(
      configured('alerts.oneCDeadLetterMax', env.ALERT_ONEC_DEADLETTER_MAX),
      0
    ),
  };
}
