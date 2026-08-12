import type { PrismaClient } from '@prisma/client';
import { log } from '@/lib/logging';

/**
 * Значения feature-флагов, заданные в интерфейсе (`У-65`, `У-66`).
 *
 * Хранятся в той же таблице, что и настройки интеграций (`IntegrationSetting`),
 * под префиксом `feature.` — второй таблицы того же назначения не заводим:
 * две таблицы настроек неизбежно разъедутся. Механизм тот же, что у
 * интеграций: **синхронно читаемый снапшот** с TTL, потому что
 * `isFeatureEnabled` синхронна и её читают 75 файлов, включая edge-middleware.
 *
 * Fail-open: до первого прайма и при любой ошибке базы снапшота нет, и
 * читатели остаются на переменных окружения — ровно прежнее поведение.
 * Именно поэтому флаги, закрывающие разделы (edge-middleware), остаются за
 * сервером: снапшот туда не доедет.
 */
const TTL_MS = 30_000;
const PREFIX = 'feature.';

let snapshot: Map<string, string> | null = null;
let lastAttemptAt = 0;

/** Ключ строки в `IntegrationSetting` для флага. */
export function featureSettingKey(flag: string): string {
  return `${PREFIX}${flag}`;
}

/**
 * Загрузка снапшота одним запросом. В снапшот попадают только непустые
 * значения — остальное читается из env вживую, поэтому снапшот не
 * «замораживает» env-значения.
 */
export async function primeFeatureFlagCache(prisma: PrismaClient): Promise<void> {
  const now = Date.now();
  if (now - lastAttemptAt < TTL_MS) return;
  lastAttemptAt = now;
  try {
    const rows = await prisma.integrationSetting.findMany({
      where: { key: { startsWith: PREFIX } },
      select: { key: true, value: true },
    });
    const next = new Map<string, string>();
    for (const row of rows) {
      if (row.value === null || row.value === '') continue;
      next.set(row.key.slice(PREFIX.length), row.value);
    }
    snapshot = next;
  } catch (err) {
    log.warn('[feature-flags] cache prime failed — env fallback', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Значение флага, заданное в интерфейсе, или `null` — «в базе не задано»
 * (тогда читатель берёт env). Синхронно: снапшот уже в памяти.
 */
export function cachedFeatureFlagValue(flag: string): string | null {
  return snapshot?.get(flag) ?? null;
}

/** Сброс после переключения в UI — следующий prime перечитает базу. */
export function resetFeatureFlagCache(): void {
  snapshot = null;
  lastAttemptAt = 0;
}
