import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isInboundMessageInScope } from './scope';

/**
 * Разрешение на скачивание вложения входящего сообщения (роут
 * `GET /api/manager/inbox/[id]/attachment`).
 *
 * Скоуп — общий C8-предикат `isInboundMessageInScope` (тот же, что у
 * `listInbox`): менеджер видит вложения сообщений СВОЕЙ компании плюс общей
 * очереди разбора (`companyId = null`) и НИКОГДА — чужой компании. Вне скоупа
 * это `not_found`, а не `forbidden`: существование сообщения не должно утекать
 * между тенантами.
 *
 * Коды: `not_found` — нет сообщения / вне скоупа / нет вложения / скан ещё не
 * подтвердил чистоту (pending/none/error); `quarantined` — ClamAV пометил файл
 * заражённым (CLAUDE.md §10 → 410, отдельный сигнал; скоуп к этому моменту уже
 * пройден, поэтому 410 говорит только о видимом этому менеджеру файле).
 */

export type InboundAttachmentResult =
  | { ok: true; path: string; downloadName: string }
  | { ok: false; error: 'not_found' | 'quarantined' };

export async function getInboundAttachmentForDownload(
  prisma: PrismaClient,
  session: SessionPayload,
  messageId: string
): Promise<InboundAttachmentResult> {
  const msg = await prisma.inboundMessage.findUnique({
    where: { id: messageId },
    select: {
      companyId: true,
      status: true,
      attachmentPath: true,
      attachmentName: true,
      scanStatus: true,
    },
  });

  if (!msg) {
    return { ok: false, error: 'not_found' };
  }

  if (!isInboundMessageInScope(session, msg)) {
    return { ok: false, error: 'not_found' };
  }

  if (!msg.attachmentPath) {
    return { ok: false, error: 'not_found' };
  }

  if (msg.scanStatus === 'infected') {
    return { ok: false, error: 'quarantined' };
  }

  if (msg.scanStatus !== 'clean') {
    // pending/none/error → not downloadable yet (distinct from quarantined)
    return { ok: false, error: 'not_found' };
  }

  return {
    ok: true,
    path: msg.attachmentPath,
    downloadName: msg.attachmentName ?? 'attachment',
  };
}
