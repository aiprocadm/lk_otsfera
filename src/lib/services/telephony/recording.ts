import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Разрешение на скачивание записи разговора (роут
 * `GET /api/manager/calls/[id]/recording`).
 *
 * IDOR/company-scope здесь несущий: запись разговора чувствительна, поэтому
 * ЛЮБАЯ неоднозначность запрещает, а не открывает. Отказ даётся, если звонок
 * чужой компании, ещё не привязан к компании (`companyId = null`) либо у самой
 * сессии нет компании — `null === null` не считается совпадением.
 *
 * Коды: `not_found` — нет звонка / вне скоупа / нет файла / скан ещё не
 * подтвердил чистоту (pending/none/error); `quarantined` — ClamAV пометил файл
 * заражённым (CLAUDE.md §10: это отдельный сигнал, роут отвечает 410, а не
 * 404 — к моменту проверки скоуп уже пройден, значит 410 говорит только о
 * СВОЕЙ записи и ничего не раскрывает про чужие компании).
 */

export type CallRecordingResult =
  { ok: true; path: string } | { ok: false; error: 'not_found' | 'quarantined' };

export async function getCallRecordingForDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  callId: string
): Promise<CallRecordingResult> {
  const call = await prisma.call.findUnique({
    where: { id: callId },
    select: { companyId: true, recordingPath: true, recordingScanStatus: true },
  });

  if (!call) {
    return { ok: false, error: 'not_found' };
  }

  if (!call.companyId || !session.companyId || call.companyId !== session.companyId) {
    return { ok: false, error: 'not_found' };
  }

  if (!call.recordingPath) {
    return { ok: false, error: 'not_found' };
  }

  if (call.recordingScanStatus === 'infected') {
    return { ok: false, error: 'quarantined' };
  }

  if (call.recordingScanStatus !== 'clean') {
    // pending/none/error → not downloadable yet (distinct from quarantined)
    return { ok: false, error: 'not_found' };
  }

  return { ok: true, path: call.recordingPath };
}
