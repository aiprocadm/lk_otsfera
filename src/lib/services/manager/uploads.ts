import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { notifyOrgUsers, notifyPartnerUsers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';
import { validateMagicBytes, SUPPORTED_MIME_TYPES } from '@/lib/storage/mimeValidator';

// Early-exit guards (mirrors upload-core limits — checked before any DB query
// to preserve the fast-path behavior from before the upload-core refactor).
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set<string>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

/**
 * Manager-facing upload service for order documents.
 *
 * Supports two recipient channels: 'organization' (manager → org, outgoing)
 * and 'partner' (manager → partner, outgoing). Delegates storage, persistence,
 * scan enqueue, and audit to `persistUploadedDocument` (upload-core).
 * Fan-out notifications are routed to ONLY the chosen channel — never both.
 *
 * RBAC uses `canSeeOrder` from managerPolicy (C8 team-mode-aware).
 * Partner channel requires `order.partnerId != null`, else `invalid_recipient`.
 *
 * Failures degrade gracefully:
 *   - Notification fan-out failures are logged but do not bubble up — they
 *     must not block the upload from the manager's perspective.
 */

export type DocumentRecipient = 'organization' | 'partner';

export type CreateCounterpartyDocumentArgs = {
  orderId: string;
  recipient: DocumentRecipient;
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

export type CreateCounterpartyDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'forbidden' | 'too_large' | 'invalid_mime' | 'storage' | 'not_found' | 'invalid_recipient';
    };

export async function createCounterpartyDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateCounterpartyDocumentArgs
): Promise<CreateCounterpartyDocumentResult> {
  // Fast-path: reject invalid input before any DB query.
  if (args.file.size > MAX_FILE_SIZE_BYTES) return { ok: false, error: 'too_large' };
  if (!ALLOWED_MIME_TYPES.has(args.file.mimeType)) return { ok: false, error: 'invalid_mime' };
  if ((SUPPORTED_MIME_TYPES as readonly string[]).includes(args.file.mimeType)) {
    const validation = validateMagicBytes(args.file.mimeType, args.file.buffer);
    if (!validation.ok) return { ok: false, error: 'invalid_mime' };
  }

  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({
    where: { id: args.orderId },
    select: {
      id: true,
      managerId: true,
      organizationId: true,
      partnerId: true,
      companyId: true,
      orderNumber: true,
      title: true
    }
  });
  if (!order) return { ok: false, error: 'not_found' };

  // Company-wide ⇒ same-company decides; otherwise three-way (count comments
  // only when managerId/org miss).
  let commentsCountByMe = 0;
  if (!teamMode && order.managerId !== session.sub) {
    const inOrgScope =
      order.organizationId !== null && managedOrgIds(session).includes(order.organizationId);
    if (!inOrgScope) {
      commentsCountByMe = await prisma.comment.count({
        where: { orderId: order.id, authorId: session.sub }
      });
    }
  }
  if (!canSeeOrder(session, { ...order, commentsCountByMe }, teamMode)) {
    return { ok: false, error: 'forbidden' };
  }

  // Resolve the target channel. Partner channel requires the order to have a partner.
  const counterparty =
    args.recipient === 'partner'
      ? order.partnerId
        ? { type: 'partner' as const, id: order.partnerId }
        : null
      : { type: 'organization' as const, id: order.organizationId };
  if (!counterparty) return { ok: false, error: 'invalid_recipient' };

  const persisted = await persistUploadedDocument(prisma, {
    counterparty,
    orderId: order.id,
    direction: 'outgoing',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'manager',
    file: args.file
  });
  if (!persisted.ok) return persisted;

  // Fan out to the recipient channel only (best-effort — never roll back upload).
  try {
    if (counterparty.type === 'organization') {
      await notifyOrgUsers(prisma, {
        organizationId: counterparty.id,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    } else {
      await notifyPartnerUsers(prisma, {
        partnerId: counterparty.id,
        type: 'document_published',
        payload: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTitle: order.title,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    }
  } catch (err) {
    console.warn('[manager/uploads] recipient notify failed', {
      documentId: persisted.documentId,
      recipient: args.recipient,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
