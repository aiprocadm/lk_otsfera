import type { PrismaClient } from '@prisma/client';
import type { OneCOrderDto, OneCPaymentDto } from './dto';
import { mapOrderDto, mapPaymentDto } from './mappers';
import { resolveOrganizationRef } from './resolve-org';
import type { BatchSummary } from './record-batch';
import type { OneCMode } from './config';
import type { ImportScope } from './scope';
import { notifyOrgUsers, notifyManagers } from '@/lib/notifications';

export type WriteCtx = { mode: OneCMode; notify: boolean; scope?: ImportScope; bump?: (iso: string) => void };
const isLive = (c: WriteCtx) => c.mode === 'live';

export function orgInScope(scope: ImportScope | undefined, orgId: string): boolean {
  if (!scope || scope.unscoped) return true;
  return scope.allowedOrgIds.includes(orgId);
}

export async function upsertOrderRecord(db: PrismaClient, dto: OneCOrderDto, sum: BatchSummary, ctx: WriteCtx) {
  const input = mapOrderDto(dto);
  const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId });
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
      await notifyOrgUsers(db, { organizationId: targetOrgId, type: 'order_status_changed', payload: {
        orderId: existing.id, orderNumber: existing.orderNumber, orderTitle: existing.title,
        dimension: 'financial', oldStatus: existing.financialStatus, newStatus: input.financialStatus } });
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
    const org = await resolveOrganizationRef(db, { externalId: input.organizationExternalId });
    if (!org) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }
    if (!orgInScope(ctx.scope, org.id)) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'out_of_scope' }); return; }
    organizationId = org.id;
  }

  if (!organizationId) { sum.skipped += 1; sum.skips.push({ externalId: input.externalId, reason: 'organization_not_found' }); return; }

  const existing = await db.payment.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  const updatable = { amount: input.amount, paidAt: input.paidAt, method: input.method, isRefund: input.isRefund };
  if (existing) {
    if (isLive(ctx)) await db.payment.update({ where: { id: existing.id }, data: updatable });
    sum.updated += 1; ctx.bump?.(dto.updatedAt);
  } else {
    if (isLive(ctx)) await db.payment.create({ data: { ...updatable, externalId: input.externalId, orderId, organizationId } });
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
