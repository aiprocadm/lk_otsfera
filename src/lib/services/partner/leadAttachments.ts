import { randomUUID } from 'crypto';
import type { PrismaClient, LeadAttachment, LeadStatus } from '@prisma/client';
import { getObjectStorage } from '@/lib/storage';
import {
  validateMagicBytes,
  extensionFor,
  type SupportedMimeType
} from '@/lib/storage/mimeValidator';
import { isPartnerAdmin } from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

const DELETABLE_STATUSES: LeadStatus[] = ['new', 'in_review'];

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type LeadAttachmentRow = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUserName: string | null;
};

export type UploadLeadAttachmentInput = {
  leadId: string;
  partnerId: string;
  scopeOrgIds?: string[];
  uploadedByUserId: string;
  file: {
    buffer: Uint8Array;
    name: string;
    declaredMimeType: string;
    size: number;
  };
};

export type LeadAttachmentErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_FILENAME'
  | 'STORAGE_FAILURE'
  | 'LEAD_NOT_EDITABLE'
  | 'INFECTED';

export type LeadAttachmentFailure = {
  ok: false;
  error: LeadAttachmentErrorCode;
  message: string;
  meta?: { scanReason?: string | null };
};

export class LeadAttachmentError extends Error {
  constructor(
    public code: LeadAttachmentErrorCode,
    message: string,
    public meta?: { scanReason?: string | null }
  ) {
    super(message);
    this.name = 'LeadAttachmentError';
  }
}

/** Boundary helper: domain error → Result failure; unexpected errors re-throw. */
function toFailure(e: unknown): LeadAttachmentFailure {
  if (e instanceof LeadAttachmentError) {
    return { ok: false, error: e.code, message: e.message, ...(e.meta ? { meta: e.meta } : {}) };
  }
  throw e;
}

function maxFileSizeBytes(): number {
  const mbStr = process.env.DOCUMENT_MAX_FILE_SIZE_MB?.trim();
  const mb = mbStr ? Number(mbStr) : 10;
  if (!Number.isFinite(mb) || mb <= 0) return 10 * 1024 * 1024;
  return Math.floor(mb * 1024 * 1024);
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

async function loadLeadInScope(
  prisma: PrismaClient,
  args: { leadId: string; partnerId: string; scopeOrgIds?: string[] }
) {
  return prisma.lead.findFirst({
    where: {
      id: args.leadId,
      partnerId: args.partnerId,
      ...(args.scopeOrgIds && args.scopeOrgIds.length > 0
        ? { OR: [{ organizationId: { in: args.scopeOrgIds } }, { organizationId: null }] }
        : {})
    },
    select: { id: true, status: true }
  });
}

export async function uploadLeadAttachment(
  prisma: PrismaClient,
  input: UploadLeadAttachmentInput
): Promise<{ ok: true; attachment: LeadAttachment } | LeadAttachmentFailure> {
  try {
    if (input.file.size > maxFileSizeBytes()) {
      throw new LeadAttachmentError('FILE_TOO_LARGE', 'Файл превышает разрешённый размер');
    }
    const safeBase = sanitizeFilename(input.file.name);
    if (!safeBase) throw new LeadAttachmentError('INVALID_FILENAME', 'Некорректное имя файла');

    const validation = validateMagicBytes(input.file.declaredMimeType, input.file.buffer);
    if (!validation.ok) {
      throw new LeadAttachmentError('UNSUPPORTED_MEDIA_TYPE', `MIME validation failed: ${validation.reason}`);
    }

    const lead = await loadLeadInScope(prisma, {
      leadId: input.leadId,
      partnerId: input.partnerId,
      scopeOrgIds: input.scopeOrgIds
    });
    if (!lead) throw new LeadAttachmentError('NOT_FOUND', 'Заявка не найдена');
    if (!DELETABLE_STATUSES.includes(lead.status)) {
      throw new LeadAttachmentError('LEAD_NOT_EDITABLE', 'Заявка более не редактируется');
    }

    const fileId = randomUUID();
    const ext = extensionFor(validation.mime);
    const path = `partners/${input.partnerId}/leads/${input.leadId}/${fileId}.${ext}`;

    const storage = getObjectStorage();
    try {
      await storage.upload(path, Buffer.from(input.file.buffer), { contentType: validation.mime });
    } catch (e) {
      throw new LeadAttachmentError('STORAGE_FAILURE', e instanceof Error ? e.message : String(e));
    }

    try {
      const attachment = await prisma.$transaction(async (tx) => {
        const created = await tx.leadAttachment.create({
          data: {
            leadId: input.leadId,
            createdByUserId: input.uploadedByUserId,
            name: input.file.name,
            path,
            mimeType: validation.mime,
            size: input.file.size
          }
        });
        await recordAudit(tx, {
          userId: input.uploadedByUserId,
          action: 'lead_attachment_uploaded',
          entity: 'lead_attachment',
          entityId: created.id,
          after: {
            leadId: input.leadId,
            partnerId: input.partnerId,
            name: input.file.name,
            mimeType: validation.mime,
            size: input.file.size,
          },
        });
        return created;
      });

      // Best-effort enqueue of async ClamAV scan. Failure leaves scanStatus='pending'
      // (graceful — attachment stays usable; backfill sweeps stuck rows).
      try {
        const payload: ScanDocumentPayload = { kind: 'leadAttachment', id: attachment.id };
        await getQueue('docs.scanDocument').add('scan', payload);
      } catch (err) {
        console.warn('[leadAttachments] enqueue scan failed', {
          attachmentId: attachment.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }

      return { ok: true, attachment };
    } catch (err) {
      // Compensate: best-effort delete the orphan object so storage stays consistent.
      await storage.remove([path]).catch(() => undefined);
      throw err;
    }
  } catch (e) {
    return toFailure(e);
  }
}

export type DeleteLeadAttachmentInput = {
  attachmentId: string;
  partnerId: string;
  scopeOrgIds?: string[];
  session: SessionPayload;
};

export async function deleteLeadAttachment(
  prisma: PrismaClient,
  input: DeleteLeadAttachmentInput
): Promise<{ ok: true } | LeadAttachmentFailure> {
  try {
    const attachment = await prisma.leadAttachment.findFirst({
      where: { id: input.attachmentId },
      include: {
        lead: { select: { id: true, partnerId: true, status: true, organizationId: true } }
      }
    });
    if (!attachment || attachment.lead.partnerId !== input.partnerId) {
      throw new LeadAttachmentError('NOT_FOUND', 'Вложение не найдено');
    }

    const lead = attachment.lead;
    if (input.scopeOrgIds && input.scopeOrgIds.length > 0) {
      const inScope = lead.organizationId === null || input.scopeOrgIds.includes(lead.organizationId);
      if (!inScope) throw new LeadAttachmentError('NOT_FOUND', 'Вложение не найдено');
    }

    if (!DELETABLE_STATUSES.includes(lead.status)) {
      throw new LeadAttachmentError('LEAD_NOT_EDITABLE', 'Заявка более не редактируется');
    }

    const userId = input.session.sub;
    const allowed =
      attachment.createdByUserId === userId || isPartnerAdmin(input.session);
    if (!allowed) {
      throw new LeadAttachmentError('FORBIDDEN', 'Только автор или partner-admin может удалить вложение');
    }

    await prisma.$transaction(async (tx) => {
      await tx.leadAttachment.delete({ where: { id: attachment.id } });
      await recordAudit(tx, {
        userId,
        action: 'lead_attachment_deleted',
        entity: 'lead_attachment',
        entityId: attachment.id,
        after: { leadId: lead.id, partnerId: input.partnerId, name: attachment.name },
      });
    });

    await getObjectStorage()
      .remove([attachment.path])
      .catch(() => undefined);

    return { ok: true };
  } catch (e) {
    return toFailure(e);
  }
}

export type GetDownloadUrlInput = {
  attachmentId: string;
  partnerId: string;
  scopeOrgIds?: string[];
};

export async function getLeadAttachmentDownloadUrl(
  prisma: PrismaClient,
  input: GetDownloadUrlInput
): Promise<{ ok: true; url: string; name: string; mimeType: string } | LeadAttachmentFailure> {
  try {
    const attachment = await prisma.leadAttachment.findFirst({
      where: { id: input.attachmentId },
      include: {
        lead: { select: { partnerId: true, organizationId: true } }
      }
    });
    if (!attachment || attachment.lead.partnerId !== input.partnerId) {
      throw new LeadAttachmentError('NOT_FOUND', 'Вложение не найдено');
    }
    if (input.scopeOrgIds && input.scopeOrgIds.length > 0) {
      const inScope =
        attachment.lead.organizationId === null ||
        input.scopeOrgIds.includes(attachment.lead.organizationId);
      if (!inScope) throw new LeadAttachmentError('NOT_FOUND', 'Вложение не найдено');
    }
    if (attachment.scanStatus === 'infected') {
      throw new LeadAttachmentError(
        'INFECTED',
        'Файл помещён в карантин антивирусом',
        { scanReason: attachment.scanReason }
      );
    }

    let url: string;
    try {
      url = await getObjectStorage().createSignedUrl(attachment.path, DOWNLOAD_URL_TTL_SECONDS, {
        download: attachment.name
      });
    } catch (e) {
      throw new LeadAttachmentError(
        'STORAGE_FAILURE',
        e instanceof Error ? e.message : 'Не удалось создать ссылку'
      );
    }

    return { ok: true, url, name: attachment.name, mimeType: attachment.mimeType };
  } catch (e) {
    return toFailure(e);
  }
}

export async function listLeadAttachments(
  prisma: PrismaClient,
  args: { leadId: string; partnerId: string; scopeOrgIds?: string[] }
): Promise<{ ok: true; rows: LeadAttachmentRow[] } | LeadAttachmentFailure> {
  try {
    const lead = await loadLeadInScope(prisma, args);
    if (!lead) throw new LeadAttachmentError('NOT_FOUND', 'Заявка не найдена');

    const rows = await prisma.leadAttachment.findMany({
      where: { leadId: lead.id, ...INFECTED_HIDDEN_WHERE },
      orderBy: { createdAt: 'desc' },
      include: { createdByUser: { select: { name: true } } }
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
        createdByUserName: r.createdByUser?.name ?? null
      }))
    };
  } catch (e) {
    return toFailure(e);
  }
}

export const __testing = {
  maxFileSizeBytes,
  sanitizeFilename,
  DELETABLE_STATUSES
};

export type { SupportedMimeType };
