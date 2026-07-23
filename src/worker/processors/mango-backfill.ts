import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getMangoAdapter } from '@/lib/telephony/mango';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { parseMangoEvent } from '@/lib/telephony/mango/parse';
import { ingestCallEvent } from '@/lib/services/telephony/ingestCall';
import { writeSyncLog } from '@/lib/services/oneCSync/log';
import { log } from '@/lib/logging';

const STATE_ENTITY = 'telephony.mango';
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_POLL_ATTEMPTS = 10;
const DEFAULT_POLL_DELAY_MS = 3000;

function pollDelayMsFromEnv(): number {
  const raw = Number(process.env.MANGO_STATS_POLL_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_POLL_DELAY_MS;
}

export type MangoBackfillResult = {
  ingested: number;
};

/**
 * Hourly safety-net backfill against Mango's two-step /vpbx/stats API.
 * Pulls completed-call rows for the window since the last successful run
 * (or a 24h lookback on first run) and re-ingests each through the same
 * `ingestCallEvent` upsert the live webhook path uses, so rows already
 * created by webhooks are deduped via the `provider_externalId` composite
 * unique — this job only fills gaps from missed/dropped webhook events.
 */
export async function mangoBackfillProcessor(
  _job: Job,
  db: PrismaClient = prisma,
  now: Date = new Date(),
  pollDelayMs: number = pollDelayMsFromEnv()
): Promise<MangoBackfillResult> {
  // REST-адаптер читает креды Mango из кэша настроек интеграций — праймим,
  // чтобы значения из /admin/integrations доезжали до воркера без рестарта.
  await primeIntegrationSettingsCache(db);

  const state = await db.syncState.findUnique({ where: { entity: STATE_ENTITY } });
  const to = now;
  const from = state?.cursor ? new Date(state.cursor) : new Date(now.getTime() - DEFAULT_LOOKBACK_MS);

  const adapter = getMangoAdapter();
  const { key } = await adapter.requestStats({ from: from.toISOString(), to: to.toISOString() });

  // Two-step API: requestStats returns a key, fetchStatsResult polls for
  // readiness. Bounded so a stuck/slow report never hangs the worker — if it
  // never becomes ready within MAX_POLL_ATTEMPTS, rows stays empty and the
  // next hourly cron tick retries the same window (cursor only advances
  // below regardless, since `to` is always "now" — see note on rows==[]).
  let rows: unknown[] = [];
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    // Пауза между попытками (не перед первой): без неё бюджет из 10 попыток
    // сгорает за миллисекунды — реальный отчёт Mango не успевает подготовиться,
    // а API получает бессмысленную очередь запросов.
    if (attempt > 0 && pollDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
    const res = await adapter.fetchStatsResult(key);
    if (res.ready) {
      rows = res.rows;
      break;
    }
  }

  let ingested = 0;
  for (const row of rows) {
    const event = parseMangoEvent('summary', row);
    if (!event) continue;
    await ingestCallEvent(db, event).catch((err) => {
      log.warn('[mango-backfill] ingest failed', {
        error: err instanceof Error ? err.message : String(err)
      });
    });
    ingested++;
  }

  await db.syncState.upsert({
    where: { entity: STATE_ENTITY },
    create: { entity: STATE_ENTITY, cursor: to.toISOString(), lastRunAt: now, lastSuccessAt: now },
    update: { cursor: to.toISOString(), lastRunAt: now, lastSuccessAt: now }
  });

  await writeSyncLog(
    { entity: 'call', direction: 'inbound', operation: 'import', status: 'success', payload: { ingested } },
    db
  ).catch(() => {});

  return { ingested };
}
