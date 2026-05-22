import { randomUUID } from 'crypto';
import type { PrismaClient, LeadAttachment, LeadStatus } from '@prisma/client';
import { getServerClient, documentBucket } from '@/lib/storage/supabase';
import {
  validateMagicBytes,
  extensionFor,
  type SupportedMimeType
} from '@/lib/storage/mimeValidator';
import { isPartnerAdmin } from '@/lib/auth/policy';
import type { SessionPayload } from '@/lib/auth/jwt';

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

export class LeadAttachmentError extends Error {
  constructor(
    public code:
      | 'NOT_FOUND'
      | 'FORBIDDEN'
      | 'UNSUPPORTED_MEDIA_TYPE'
      | 'FILE_TOO_LARGE'
      | 'INVALID_FILENAME'
      | 'STORAGE_FAILURE'
      | 'LEAD_NOT_EDITABLE',
    message: string
  ) {
    super(message);
    this.name = 'LeadAttachmentError';
  }
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
): Promise<LeadAttachment> {
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

  const storage = getServerClient().storage.from(documentBucket);
  const uploadRes = await storage.upload(path, input.file.buffer, {
    contentType: validation.mime,
    upsert: false
  });
  if (uploadRes.error) {
    throw new LeadAttachmentError('STORAGE_FAILURE', uploadRes.error.message);
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
      await tx.auditLog.create({
        data: {
          userId: input.uploadedByUserId,
          action: 'lead_attachment_uploaded',
          entity: 'LeadAttachment',
          entityId: created.id,
          meta: {
            leadId: input.leadId,
            partnerId: input.partnerId,
            name: input.file.name,
            mimeType: validation.mime,
            size: input.file.size
          }
        }
      });
      return created;
    });
    return attachment;
  } catch (err) {
    // Compensate: best-effort delete the orphan object so storage stays consistent.
    await storage.remove([path]).catch(() => undefined);
    throw err;
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
): Promise<void> {
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

  await prisma.$transaction([
    prisma.leadAttachment.delete({ where: { id: attachment.id } }),
    prisma.auditLog.create({
      data: {
        userId,
        action: 'lead_attachment_deleted',
        entity: 'LeadAttachment',
        entityId: attachment.id,
        meta: { leadId: lead.id, partnerId: input.partnerId, name: attachment.name }
      }
    })
  ]);

  await getServerClient()
    .storage.from(documentBucket)
    .remove([attachment.path])
    .catch(() => undefined);
}

export type GetDownloadUrlInput = {
  attachmentId: string;
  partnerId: string;
  scopeOrgIds?: string[];
};

export async function getLeadAttachmentDownloadUrl(
  prisma: PrismaClient,
  input: GetDownloadUrlInput
): Promise<{ url: string; name: string; mimeType: string }> {
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

  const signed = await getServerClient()
    .storage.from(documentBucket)
    .createSignedUrl(attachment.path, DOWNLOAD_URL_TTL_SECONDS, {
      download: attachment.name
    });
  if (signed.error || !signed.data?.signedUrl) {
    throw new LeadAttachmentError(
      'STORAGE_FAILURE',
      signed.error?.message ?? 'Не удалось создать ссылку'
    );
  }

  return { url: signed.data.signedUrl, name: attachment.name, mimeType: attachment.mimeType };
}

export async function listLeadAttachments(
  prisma: PrismaClient,
  args: { leadId: string; partnerId: string; scopeOrgIds?: string[] }
): Promise<LeadAttachmentRow[]> {
  const lead = await loadLeadInScope(prisma, args);
  if (!lead) throw new LeadAttachmentError('NOT_FOUND', 'Заявка не найдена');

  const rows = await prisma.leadAttachment.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'desc' },
    include: { createdByUser: { select: { name: true } } }
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    size: r.size,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    createdByUserId: r.createdByUserId,
    createdByUserName: r.createdByUser?.name ?? null
  }));
}

export const __testing = {
  maxFileSizeBytes,
  sanitizeFilename,
  DELETABLE_STATUSES
};

export type { SupportedMimeType };
