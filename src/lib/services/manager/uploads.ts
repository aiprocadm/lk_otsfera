import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { notifyOrgUsers, notifyPartnerUsers } from '@/lib/notifications';
import { persistUploadedDocument, validateUploadFile } from '@/lib/services/documents/upload-core';
import { canManagerUploadOrderLess } from '@/lib/auth/documentChannelPolicy';
import { listManagerCounterparties } from '@/lib/services/manager/counterparties';
import { log } from '@/lib/logging';

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
  const fileCheck = validateUploadFile(args.file);
  if (!fileCheck.ok) return fileCheck;

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
    log.warn('[manager/uploads] recipient notify failed', {
      documentId: persisted.documentId,
      recipient: args.recipient,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, documentId: persisted.documentId };
}

// ─── Order-less upload (Phase B) ──────────────────────────────────────────────

export type CreateManagerOrderLessArgs = {
  counterparty: { type: DocumentRecipient; id: string };
  docType: string;
  file: { name: string; size: number; mimeType: string; buffer: Buffer };
};

/**
 * Manager uploads a document not tied to any order (Phase B "общие документы").
 *
 * RBAC: counterparty must be within the manager's resolved scope
 * (listManagerCounterparties — org-scoped or company-wide per teamMode).
 * The document is pinned to session.companyId (cross-company isolation).
 * Notification fan-out is best-effort — never blocks the upload.
 */
export async function createManagerOrderLessDocument(
  prisma: PrismaClient,
  session: SessionPayload,
  args: CreateManagerOrderLessArgs
): Promise<CreateCounterpartyDocumentResult> {
  const fileCheck = validateUploadFile(args.file);
  if (!fileCheck.ok) return fileCheck;

  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const { organizations, partners } = await listManagerCounterparties(prisma, session);
  const scope = {
    managedOrgIds: organizations.map((o) => o.id),
    partnerIds: partners.map((p) => p.id)
  };
  if (!canManagerUploadOrderLess(args.counterparty, scope)) {
    return { ok: false, error: 'forbidden' };
  }

  const persisted = await persistUploadedDocument(prisma, {
    counterparty: args.counterparty,
    orderId: null,
    companyId: session.companyId,
    direction: 'outgoing',
    docType: args.docType,
    uploadedById: session.sub,
    source: 'manager',
    file: args.file
  });
  if (!persisted.ok) return persisted;

  try {
    if (args.counterparty.type === 'organization') {
      await notifyOrgUsers(prisma, {
        organizationId: args.counterparty.id,
        type: 'document_published',
        payload: {
          orderId: null,
          orderNumber: null,
          orderTitle: null,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    } else {
      await notifyPartnerUsers(prisma, {
        partnerId: args.counterparty.id,
        type: 'document_published',
        payload: {
          orderId: null,
          orderNumber: null,
          orderTitle: null,
          documentName: args.file.name,
          documentType: args.docType
        }
      });
    }
  } catch (err) {
    log.warn('[manager/uploads] order-less notify failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  return { ok: true, documentId: persisted.documentId };
}
