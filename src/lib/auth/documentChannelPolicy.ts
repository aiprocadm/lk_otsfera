import type { Prisma } from '@prisma/client';
import { INFECTED_HIDDEN_WHERE } from '@/lib/services/scan/visibility';

/**
 * Channel isolation for documents (spec 2026-06-07-document-exchange).
 *
 * Every Document belongs to a channel = (counterpartyType, counterpartyId)
 * exchanged between that counterparty and the managers who scope it. Isolation
 * constrains CLIENTS: an organization sees only its organization-channel, a
 * partner only its partner-channel. Managers see both channels within their
 * existing order/company scope (managerPolicy), so there is intentionally no
 * manager where-builder here in Phase A.
 *
 * This module is the single source of truth for the client-side channel rule —
 * do not inline `{ counterpartyType, counterpartyId }` filters in cabinet
 * services; call these helpers so the rule cannot drift (CLAUDE.md §4).
 */

export type CounterpartyType = 'organization' | 'partner';
export type DocumentChannel = { type: CounterpartyType; id: string };

export function organizationChannelWhere(organizationId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'organization',
    counterpartyId: organizationId,
    ...INFECTED_HIDDEN_WHERE
  };
}

export function partnerChannelWhere(partnerId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'partner',
    counterpartyId: partnerId,
    ...INFECTED_HIDDEN_WHERE
  };
}

/**
 * Membership check for a fetched document — used by download guards to return a
 * silent `not_found` when a document is outside the caller's channel (no
 * existence leak).
 */
export function documentInChannel(
  doc: { counterpartyType: CounterpartyType; counterpartyId: string },
  channel: DocumentChannel
): boolean {
  return doc.counterpartyType === channel.type && doc.counterpartyId === channel.id;
}

/** Order-bound vs order-less axis — composed with the channel where-builders. */
export function orderBoundWhere(): Prisma.DocumentWhereInput {
  return { orderId: { not: null } };
}
export function orderLessWhere(): Prisma.DocumentWhereInput {
  return { orderId: null };
}

/**
 * Manager visibility for order-less documents. Order-less docs have no order,
 * so teamMode (which partitions orders) does not apply — visibility is purely
 * company-level. Leader sees the same company set; admin uses /admin (Model A).
 */
export function managerOrderLessWhere(companyId: string): Prisma.DocumentWhereInput {
  return { orderId: null, companyId, ...INFECTED_HIDDEN_WHERE };
}

/** Manager order-less upload gate — channel must be in the manager's resolved scope. */
export function canManagerUploadOrderLess(
  channel: DocumentChannel,
  scope: { managedOrgIds: string[]; partnerIds: string[] }
): boolean {
  return channel.type === 'organization'
    ? scope.managedOrgIds.includes(channel.id)
    : scope.partnerIds.includes(channel.id);
}

/**
 * Read authorization for an order-less document (download gate). Order-less docs
 * cannot pass through the order-centric `canReadOrder` (order is null), so this
 * is the dedicated branch: managers gate on the doc's companyId, clients on their
 * own channel. Pure + testable — called from every download guard.
 */
export function canReadOrderLessDocument(
  session: { role: string; organizationId?: string | null; partnerId?: string | null; companyId?: string | null },
  doc: { counterpartyType: CounterpartyType; counterpartyId: string; companyId: string | null }
): boolean {
  if (session.role === 'admin') return true;
  if (session.role === 'manager') return !!doc.companyId && doc.companyId === session.companyId;
  if (session.role === 'organization') {
    return doc.counterpartyType === 'organization' && doc.counterpartyId === session.organizationId;
  }
  if (session.role === 'partner') {
    return doc.counterpartyType === 'partner' && doc.counterpartyId === session.partnerId;
  }
  return false;
}
