import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { verifyMangoSign } from '@/lib/telephony/mango/sign';
import { isMangoIpAllowed, clientIpFrom } from '@/lib/telephony/mango/ip';
import { parseMangoEvent } from '@/lib/telephony/mango/parse';
import { ingestCallEvent } from '@/lib/services/telephony/ingestCall';
import { getQueue } from '@/lib/jobs/queues';
import { log } from '@/lib/logging';

/**
 * Публичный webhook событий Mango Office VPBX (B1). Mango шлёт per-type POST
 * на `?type=call|summary|recording` с form-encoded телом (`json` + `sign`).
 *
 * Security — defense-in-depth, ОБА обязательны (провал любого → 401):
 *   1. IP-allowlist (`isMangoIpAllowed`) — проверяется ДО чтения тела запроса.
 *      NOTE: x-forwarded-for доверенен только за проксёй, которая его
 *      сама проставляет/зачищает; реальный (нефальсифицируемый) гейт — подпись ниже.
 *   2. HMAC-подобная подпись sha256(apiKey + json + salt) (`verifyMangoSign`).
 *      Отсутствие MANGO_API_KEY/MANGO_API_SALT в env — тоже 401, а не пропуск.
 *
 * Всегда 200 для аутентифицированных запросов (даже на malformed JSON и на
 * неизвестный/неразобранный event type) — чтобы Mango не ретраил бесконечно.
 * Ingest/enqueue — best-effort (§3): ошибка сервисного слоя проглатывается,
 * не блокирует основной путь и не превращается в 500.
 */
export async function POST(req: Request): Promise<Response> {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return disabled;

  // 1. IP allowlist — до чтения тела.
  if (!isMangoIpAllowed(clientIpFrom(req.headers))) {
    return new Response(null, { status: 401 });
  }

  const form = await req.formData().catch(() => null);
  const json = form?.get('json');
  const sign = form?.get('sign');

  // 2. Подпись. Отсутствующие creds или несовпадающая подпись — всегда 401.
  const apiKey = process.env.MANGO_API_KEY?.trim();
  const salt = process.env.MANGO_API_SALT?.trim();
  if (
    !apiKey ||
    !salt ||
    typeof json !== 'string' ||
    typeof sign !== 'string' ||
    !verifyMangoSign({ apiKey, salt, json, sign })
  ) {
    return new Response(null, { status: 401 });
  }

  const eventType = new URL(req.url).searchParams.get('type') ?? 'summary';

  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    // Malformed JSON (but signed) — 200, чтобы Mango не ретраил.
    return new Response(null, { status: 200 });
  }

  // event содержит только DATA от Mango, никогда не интерпретируется как код.
  const event = parseMangoEvent(eventType, payload);
  if (event) {
    await ingestCallEvent(prisma, event).catch((e: unknown) => {
      log.error('[webhook/mango] ingest failed', {
        externalId: event.externalId,
        error: e instanceof Error ? e.message : String(e)
      });
    });
    if (event.kind === 'recording' && event.recordingId) {
      // try/catch, а не .catch(): getQueue → getRedisConnection бросает
      // СИНХРОННО при отсутствующем REDIS_URL — промисный .catch это не ловил
      // и вебхук отвечал 500 (carry-over PR-4 серии укрепления).
      try {
        await getQueue('telephony.mango.recording').add('rec', {
          externalId: event.externalId,
          recordingId: event.recordingId
        });
      } catch (e) {
        log.error('[webhook/mango] recording enqueue failed', {
          externalId: event.externalId,
          error: e instanceof Error ? e.message : String(e)
        });
      }
    }
  }

  return new Response(null, { status: 200 });
}
