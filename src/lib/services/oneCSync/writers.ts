import type { PrismaClient } from '@prisma/client';
import type { OneCOrderDto, OneCPaymentDto, OneCOrgDto, OneCDocumentDto } from './dto';
import { mapOrderDto, mapPaymentDto, mapOrgDto, mapDocumentDto } from './mappers';
import { resolveOrganizationRef } from './resolve-org';
import type { BatchSummary } from './record-batch';
import type { OneCMode } from './config';
import type { ImportScope } from './scope';
import { notifyOrgUsers, notifyManagers } from '@/lib/notifications';
import { fetchAndStore1CDocument } from './document-fetch';
import { getQueue } from '@/lib/jobs/queues';
import type { ScanDocumentPayload } from '@/lib/jobs/types';

export type WriteCtx = { mode: OneCMode; notify: boolean; scope?: ImportScope; bump?: (iso: string) => void };
const isLive = (c: WriteCtx) => c.mode === 'live';

export function orgInScope(scope: ImportScope | undefined, orgId: string): boolean {
  if (!scope || scope.unscoped) return true;
  return scope.allowedOrgIds.includes(orgId);
}

export async function upsertOrderRecord(db: PrismaClient, dto: OneCOrderDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapOrderDto(dto);
  const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId, inn: input.organizationInn });
  if (!org || !org.companyId) {
    sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return;
  }
  if (!orgInScope(ctx.scope, org.id)) {
    sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return;
  }
  const existing = await db.order.findUnique({
    where: { externalId: input.externalId },
    select: { id: true, organizationId: true, financialStatus: true, orderNumber: true, title: true },
  });
  const ownedBy1C = {
    orderNumber: input.orderNumber, title: input.title, totalAmount: input.totalAmount, paidAmount: input.paidAmount,
    paidAt: input.paidAt, contractSignedAt: input.contractSignedAt, completedAt: input.completedAt, closedAt: input.closedAt,
    vatIncluded: input.vatIncluded, vatRate: input.vatRate, financialStatus: input.financialStatus,
    productMix: input.productMix, lastSyncedAt: new Date(),
  };
  if (existing) {
    if (isLive(ctx)) {
      await db.order.update({
        where: { id: existing.id },
        data: existing.organizationId === null ? { ...ownedBy1C, organizationId: org.id } : ownedBy1C,
      });
    }
    sum.updated += 1; ctx.bump?.(dto.updatedAt);
    const targetOrgId = existing.organizationId ?? org.id;
    if (ctx.notify && isLive(ctx) && targetOrgId && existing.financialStatus !== input.financialStatus) {
      try { await notifyOrgUsers(db, { organizationId: targetOrgId, type: 'order_status_changed', payload: {
        orderId: existing.id, orderNumber: existing.orderNumber, orderTitle: existing.title,
        dimension: 'financial', oldStatus: existing.financialStatus, newStatus: input.financialStatus } }); }
      catch (err) { console.warn('[1c] order status notifyOrgUsers failed', err); }
    }
  } else {
    if (isLive(ctx)) {
      await db.order.create({ data: { ...ownedBy1C, externalId: input.externalId,
        executionStatus: input.executionStatus, companyId: org.companyId, partnerId: org.partnerId, organizationId: org.id } });
    }
    sum.created += 1; ctx.bump?.(dto.updatedAt);
  }
}

export async function upsertPaymentRecord(db: PrismaClient, dto: OneCPaymentDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapPaymentDto(dto);
  let orderId: string | null = null;
  let organizationId: string | null = null;
  let order: { id: string; organizationId: string | null; orderNumber: string | null; title: string } | null = null;

  if (input.orderExternalId) {
    order = await db.order.findUnique({ where: { externalId: input.orderExternalId },
      select: { id: true, organizationId: true, orderNumber: true, title: true } });
    if (!order) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' }); return; }
    if (order.organizationId && !orgInScope(ctx.scope, order.organizationId)) {
      sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return;
    }
    orderId = order.id; organizationId = order.organizationId;
  } else {
    const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId, inn: input.organizationInn });
    if (!org) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }
    if (!orgInScope(ctx.scope, org.id)) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return; }
    organizationId = org.id;
  }

  if (!organizationId) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }

  const existing = await db.payment.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  const updatable = {
    amount: input.amount, paidAt: input.paidAt, method: input.method, isRefund: input.isRefund,
    purpose: input.purpose, paymentOrderNumber: input.paymentOrderNumber, vatAmount: input.vatAmount
  };
  if (existing) {
    if (isLive(ctx)) await db.payment.update({ where: { id: existing.id }, data: updatable });
    sum.updated += 1; ctx.bump?.(dto.updatedAt);
  } else {
    // enteredById: WriteCtx carries no acting-user id (1C sync / file import actor);
    // manual-entry wiring is future work (§7.1).
    if (isLive(ctx)) await db.payment.create({ data: { ...updatable, externalId: input.externalId, orderId, organizationId, enteredById: null } });
    sum.created += 1; ctx.bump?.(dto.updatedAt);
    if (ctx.notify && isLive(ctx) && order && order.organizationId && !input.isRefund) {
      try { await notifyOrgUsers(db, { organizationId: order.organizationId, type: 'payment_received', payload: {
        orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title, amount: input.amount.toString(), paidAt: input.paidAt } }); }
      catch (err) { console.warn('[1c] payment notifyOrgUsers failed', err); }
    }
    if (ctx.notify && isLive(ctx) && order && !input.isRefund) {
      try { await notifyManagers(db, { orderId: order.id, type: 'order_marked_paid_by_1c', payload: { amount: Number(input.amount), paidAt: input.paidAt } }); }
      catch (err) { console.warn('[1c] payment notifyManagers failed', err); }
    }
  }
}

export async function upsertOrgRecord(db: PrismaClient, dto: OneCOrgDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapOrgDto(dto);
  const partner = input.partnerExternalId
    ? await db.partner.findUnique({ where: { slug: input.partnerExternalId }, select: { id: true } })
    : null;
  const partnerId = partner?.id ?? null;
  if (!partnerId) {
    sum.skipped += 1;
    sum.skips.push({ externalId: input.externalId, reason: input.partnerExternalId ? 'partner_not_found' : 'no_partner_external_id' });
    return;
  }
  const existing = await db.organization.findUnique({ where: { externalId: input.externalId }, select: { id: true, companyId: true } });
  if (existing) {
    if (isLive(ctx)) await db.organization.update({ where: { id: existing.id }, data: { name: input.name, inn: input.inn, kpp: input.kpp } });
    sum.updated += 1; ctx.bump?.(dto.updatedAt);
  } else {
    if (isLive(ctx)) {
      await db.$transaction(async (tx) => {
        const company = await tx.company.create({ data: { name: input.name } });
        await tx.organization.create({ data: { externalId: input.externalId, name: input.name, inn: input.inn, kpp: input.kpp, partnerId, companyId: company.id } });
      });
    }
    sum.created += 1; ctx.bump?.(dto.updatedAt);
  }
}

export async function upsertDocumentRecord(db: PrismaClient, dto: OneCDocumentDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapDocumentDto(dto);
  const order = await db.order.findUnique({ where: { externalId: input.orderExternalId }, select: { id: true, organizationId: true, orderNumber: true, title: true } });
  if (!order) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'order_not_found' }); return; }
  const existing = await db.document.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  // path is NOT a 1C-owned field: it is the object-storage key set at creation
  // (DOC-03). Updates only refresh metadata and never touch path.
  const metadata = { name: input.name, mimeType: input.mimeType, size: input.size, type: input.type, signedAt: input.signedAt };
  if (existing) {
    if (isLive(ctx)) await db.document.update({ where: { id: existing.id }, data: metadata });
    sum.updated += 1; ctx.bump?.(dto.updatedAt);
  } else {
    if (isLive(ctx)) {
      // DOC-03: fetch the 1C file into object storage so `path` is a bucket key (not the
      // external URL) — download routes + ClamAV scan work unchanged. Fetch failure
      // skips the doc with a visible reason instead of crashing the batch (§3).
      const storagePath = await fetchAndStore1CDocument({ url: input.downloadUrl, orderId: order.id, name: input.name, mimeType: input.mimeType });
      if (!storagePath) {
        sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'document_fetch_failed' }); return;
      }
      const created = await db.document.create({ data: { ...metadata, path: storagePath, scanStatus: 'pending', externalId: input.externalId, orderId: order.id, direction: 'incoming', generatedBy: 'system', counterpartyType: 'organization', counterpartyId: order.organizationId } });
      // Best-effort scan enqueue, gated on Redis like commission PDF/XLSX — skipped
      // silently in environments without a queue (tests, partial dev).
      if (created?.id && process.env.REDIS_URL) {
        try {
          const payload: ScanDocumentPayload = { kind: 'document', id: created.id };
          await getQueue('docs.scanDocument').add('scan', payload);
        } catch (err) { console.warn('[1c] document scan enqueue failed', err); }
      }
    }
    sum.created += 1; ctx.bump?.(dto.updatedAt);
    if (ctx.notify && isLive(ctx) && order.organizationId) {
      try { await notifyOrgUsers(db, { organizationId: order.organizationId, type: 'document_published', payload: {
        orderId: order.id, orderNumber: order.orderNumber, orderTitle: order.title, documentName: input.name, documentType: input.type } }); }
      catch (err) { console.warn('[1c] document notifyOrgUsers failed', err); }
    }
  }
}
