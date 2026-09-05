import { randomUUID } from 'crypto';
import type { ClientRequestAttachment, ClientRequestStatus, PrismaClient } from '@prisma/client';
import { getObjectStorage } from '@/lib/storage';
import { validateMagicBytes, extensionFor } from '@/lib/storage/mimeValidator';
import { maxFileSizeBytes } from '@/lib/config/upload';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';
import { bestEffort, log } from '@/lib/logging';
import { clientRequestScopeWhere } from './list';

/**
 * Вложения заявок клиентов (этап 5, ФТ-1.3) — адаптация
 * `partner/leadAttachments.ts` под ClientRequest. Скоуп:
 * - upload/delete — только податель своей заявки в статусах submitted|in_triage;
 * - list/downloadUrl — податель ИЛИ staff в скоупе `clientRequestScopeWhere`.
 */

const EDITABLE_STATUSES: ClientRequestStatus[] = ['submitted', 'in_triage'];

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type ClientRequestAttachmentRow = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUserName: string | null;
};

type ClientRequestAttachmentErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILENAME'
  | 'STORAGE_FAILURE'
  | 'REQUEST_NOT_EDITABLE'
  | 'INFECTED';

export type ClientRequestAttachmentFailure = {
  ok: false;
  error: ClientRequestAttachmentErrorCode;
  message: string;
  meta?: { scanReason?: string | null };
};

class ClientRequestAttachmentError extends Error {
  constructor(
    public code: ClientRequestAttachmentErrorCode,
    message: string,
    public meta?: { scanReason?: string | null }
  ) {
    super(message);
    this.name = 'ClientRequestAttachmentError';
  }
}

/** Boundary helper: domain error → Result failure; unexpected errors re-throw. */
function toFailure(e: unknown): ClientRequestAttachmentFailure {
  if (e instanceof ClientRequestAttachmentError) {
    return { ok: false, error: e.code, message: e.message, ...(e.meta ? { meta: e.meta } : {}) };
  }
  throw e;
}

function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[\r\n\t]+/g, ' ');
  if (!trimmed) return '';
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 200);
  /* v8 ignore next -- 'attachment' fallback unreachable: replace() never produces '' for non-empty base */
  return cleaned || 'attachment';
}

/** Заявка в видимом скоупе сессии; чужая = несуществующая (NOT_FOUND). */
async function loadRequestInScope(
  prisma: PrismaClient,
  session: SessionPayload,
  requestId: string
) {
  return prisma.clientRequest.findFirst({
    where: { AND: [{ id: requestId }, clientRequestScopeWhere(session)] },
    select: { id: true, status: true, submittedByUserId: true },
  });
}

/** Общий гард upload/delete: видимость → авторство подателя → редактируемость. */
function assertSubmitterEditable(
  session: SessionPayload,
  request: { status: ClientRequestStatus; submittedByUserId: string } | null
): void {
  if (!request) throw new ClientRequestAttachmentError('NOT_FOUND', 'Обращение не найдено');
  if (request.submittedByUserId !== session.sub) {
    throw new ClientRequestAttachmentError(
      'FORBIDDEN',
      'Вложения может менять только податель обращения'
    );
  }
  if (!EDITABLE_STATUSES.includes(request.status)) {
    throw new ClientRequestAttachmentError(
      'REQUEST_NOT_EDITABLE',
      'Обращение более не редактируется'
    );
  }
}

export type UploadClientRequestAttachmentInput = {
  requestId: string;
  file: {
    buffer: Uint8Array;
    name: string;
    declaredMimeType: string;
    size: number;
  };
};

export async function uploadClientRequestAttachment(
  prisma: PrismaClient,
  session: SessionPayload,
  input: UploadClientRequestAttachmentInput
): Promise<{ ok: true; attachment: ClientRequestAttachment } | ClientRequestAttachmentFailure> {
  try {
    if (input.file.size > maxFileSizeBytes()) {
      throw new ClientRequestAttachmentError('FILE_TOO_LARGE', 'Файл превышает разрешённый размер');
    }
    const safeBase = sanitizeFilename(input.file.name);
    if (!safeBase)
      throw new ClientRequestAttachmentError('INVALID_FILENAME', 'Некорректное имя файла');

    const validation = validateMagicBytes(input.file.declaredMimeType, input.file.buffer);
    if (!validation.ok) {
      throw new ClientRequestAttachmentError(
        'UNSUPPORTED_MEDIA_TYPE',
        `MIME validation failed: ${validation.reason}`
      );
    }

    const request = await loadRequestInScope(prisma, session, input.requestId);
    assertSubmitterEditable(session, request);

    const fileId = randomUUID();
    const ext = extensionFor(validation.mime);
    const path = `client-requests/${input.requestId}/${fileId}.${ext}`;

    const storage = getObjectStorage();
    try {
      await storage.upload(path, Buffer.from(input.file.buffer), { contentType: validation.mime });
    } catch (e) {
      // Как в leadAttachments (R1.5): сырое сообщение провайдера — только в
      // серверный лог; клиенту — статичная строка.
      log.error('[client-request-attachments] storage upload failed', {
        requestId: input.requestId,
        storagePath: path,
        providerError: e instanceof Error ? e.message : String(e),
      });
      throw new ClientRequestAttachmentError('STORAGE_FAILURE', 'Не удалось загрузить файл');
    }

    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const created = await tx.clientRequestAttachment.create({
          data: {
            requestId: input.requestId,
            createdByUserId: session.sub,
            name: input.file.name,
            path,
            mimeType: validation.mime,
            size: input.file.size,
          },
        });
        await recordAudit(tx, {
          userId: session.sub,
          action: 'client_request_attachment_uploaded',
          entity: 'client_request_attachment',
          entityId: created.id,
          after: {
            requestId: input.requestId,
            name: input.file.name,
            mimeType: validation.mime,
            size: input.file.size,
          },
        });
        return created;
      });

      // Best-effort enqueue асинхронного ClamAV-скана. Сбой оставляет
      // scanStatus='pending' (graceful §3 — backfill доскажет застрявшие).
      try {
        const payload: ScanDocumentPayload = {
          kind: 'client_request_attachment',
          id: attachment.id,
        };
        await getQueue('docs.scanDocument').add('scan', payload);
      } catch (err) {
        log.warn('[client-request-attachments] enqueue scan failed', {
          attachmentId: attachment.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return { ok: true, attachment };
    } catch (err) {
      // Компенсация: best-effort удаляем осиротевший объект из хранилища.
      await storage
        .remove([path])
        .catch(bestEffort('[client-request-attachments] orphan remove failed'));
      throw err;
    }
  } catch (e) {
    return toFailure(e);
  }
}

export async function deleteClientRequestAttachment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { attachmentId: string }
): Promise<{ ok: true } | ClientRequestAttachmentFailure> {
  try {
    const attachment = await prisma.clientRequestAttachment.findFirst({
      where: { AND: [{ id: args.attachmentId }, { request: clientRequestScopeWhere(session) }] },
      include: {
        request: { select: { id: true, status: true, submittedByUserId: true } },
      },
    });
    if (!attachment) throw new ClientRequestAttachmentError('NOT_FOUND', 'Вложение не найдено');
    assertSubmitterEditable(session, attachment.request);

    await prisma.$transaction(async (tx) => {
      await tx.clientRequestAttachment.delete({ where: { id: attachment.id } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'client_request_attachment_deleted',
        entity: 'client_request_attachment',
        entityId: attachment.id,
        after: { requestId: attachment.request.id, name: attachment.name },
      });
    });

    await getObjectStorage()
      .remove([attachment.path])
      .catch(bestEffort('[client-request-attachments] storage remove failed'));

    return { ok: true };
  } catch (e) {
    return toFailure(e);
  }
}

export async function listClientRequestAttachments(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { requestId: string }
): Promise<{ ok: true; rows: ClientRequestAttachmentRow[] } | ClientRequestAttachmentFailure> {
  try {
    const request = await loadRequestInScope(prisma, session, args.requestId);
    if (!request) throw new ClientRequestAttachmentError('NOT_FOUND', 'Обращение не найдено');

    const rows = await prisma.clientRequestAttachment.findMany({
      where: { requestId: request.id, ...INFECTED_HIDDEN_WHERE },
      orderBy: { createdAt: 'desc' },
      include: { createdByUser: { select: { name: true } } },
    });
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id,
        name: r.name,
        size: r.size,
        mimeType: r.mimeType,
        createdAt: r.createdAt,
        createdByUserId: r.createdByUserId,
        createdByUserName: r.createdByUser?.name ?? null,
      })),
    };
  } catch (e) {
    return toFailure(e);
  }
}

export async function getClientRequestAttachmentDownloadUrl(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { attachmentId: string }
): Promise<
  { ok: true; url: string; name: string; mimeType: string } | ClientRequestAttachmentFailure
> {
  try {
    const attachment = await prisma.clientRequestAttachment.findFirst({
      where: { AND: [{ id: args.attachmentId }, { request: clientRequestScopeWhere(session) }] },
    });
    if (!attachment) throw new ClientRequestAttachmentError('NOT_FOUND', 'Вложение не найдено');
    if (attachment.scanStatus === 'infected') {
      throw new ClientRequestAttachmentError('INFECTED', 'Файл помещён в карантин антивирусом', {
        scanReason: attachment.scanReason,
      });
    }

    let url: string;
    try {
      url = await getObjectStorage().createSignedUrl(attachment.path, DOWNLOAD_URL_TTL_SECONDS, {
        download: attachment.name,
      });
    } catch (e) {
      log.error('[client-request-attachments] createSignedUrl failed', {
        attachmentId: attachment.id,
        providerError: e instanceof Error ? e.message : String(e),
      });
      throw new ClientRequestAttachmentError('STORAGE_FAILURE', 'Не удалось создать ссылку');
    }

    return { ok: true, url, name: attachment.name, mimeType: attachment.mimeType };
  } catch (e) {
    return toFailure(e);
  }
}

export const __testing = {
  maxFileSizeBytes,
  sanitizeFilename,
  EDITABLE_STATUSES,
};
