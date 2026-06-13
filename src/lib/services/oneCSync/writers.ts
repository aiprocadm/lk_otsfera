import type { PrismaClient } from '@prisma/client';
import type { OneCOrderDto } from './dto';
import { mapOrderDto } from './mappers';
import { resolveOrganizationRef } from './resolve-org';
import type { BatchSummary } from './record-batch';
import type { OneCMode } from './config';
import type { ImportScope } from './scope';
import { notifyOrgUsers } from '@/lib/notifications';

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
