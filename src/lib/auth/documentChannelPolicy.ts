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
