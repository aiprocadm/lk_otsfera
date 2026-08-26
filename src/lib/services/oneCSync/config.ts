import { cachedIntegrationSetting } from '@/lib/config/integrationSettingsCache';

/**
 * Параметры обмена с 1С (`У-125`).
 *
 * Все шесть настраиваются из интерфейса — «Автообмен → Параметры» у
 * администратора. Приоритет тот же, что у остальных настроек платформы:
 * **база → переменная сервера → умолчание в коде**. Ни одна переменная не
 * удалена из чтения: старый `.env` продолжает работать, он просто перестал
 * быть единственным источником.
 *
 * Функции синхронные, потому что их зовут синхронные читатели (адаптер,
 * writer, процессоры) — значение берётся из праймленного снапшота настроек.
 */

export type OneCMode = 'live' | 'shadow';

/** Значение настройки, затем переменной сервера — первое непустое. */
function configured(key: Parameters<typeof cachedIntegrationSetting>[0], env: string | undefined) {
  return cachedIntegrationSetting(key) ?? env;
}

export function oneCMode(): OneCMode {
  const raw = configured('onec.mode', process.env.ONE_C_MODE) ?? 'live';
  return raw.trim().toLowerCase() === 'shadow' ? 'shadow' : 'live';
}

export function oneCHttpTimeoutMs(): number {
  const raw = Number(configured('onec.httpTimeoutMs', process.env.ONE_C_HTTP_TIMEOUT_MS));
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

export function oneCCursorOverlapMinutes(): number {
  const raw = Number(
    configured('onec.cursorOverlapMinutes', process.env.ONE_C_CURSOR_OVERLAP_MINUTES)
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
}

/**
 * Компания для организаций, создаваемых СЕТЕВОЙ синхронизацией (Т-41): у
 * воркера нет сессии и скоупа, поэтому компания задаётся конфигом. Не задана →
 * null: writer отбивает создание явной построчной ошибкой
 * `company_not_configured`, а не минтит тенант молча (дефект §0.2).
 */
export function oneCDefaultCompanyId(): string | null {
  const raw = (configured('onec.defaultCompanyId', process.env.ONE_C_COMPANY_ID) ?? '').trim();
  return raw.length > 0 ? raw : null;
}

/** Max replay attempts before a pending record is dead-lettered. */
export function oneCPendingMaxAttempts(): number {
  const raw = Number(configured('onec.pendingMaxAttempts', process.env.ONE_C_PENDING_MAX_ATTEMPTS));
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

/** Max age (days) before a still-pending record is dead-lettered. */
export function oneCPendingMaxAgeDays(): number {
  const raw = Number(configured('onec.pendingMaxAgeDays', process.env.ONE_C_PENDING_MAX_AGE_DAYS));
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}
