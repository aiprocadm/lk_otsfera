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

/**
 * `У-151`: списки показывают только ДЕЙСТВУЮЩУЮ версию документа.
 *
 * Перевыпуск сохраняет номер и растит версию, а прежняя версия помечается
 * заменённой. Показывать обе — значит показывать две бумаги с одним номером:
 * человек не поймёт, какая из них настоящая, и отправит клиенту не ту.
 * Заменённая версия не удаляется и открывается по прямой ссылке — она была
 * выпущена и остаётся в истории.
 */
export const ACTIVE_VERSION_WHERE = { supersededAt: null } as const;

/**
 * Черновик коммерческого предложения клиенту НЕ показывается (`У-164`,
 * `У-165`).
 *
 * КП — единственный тип, который рождается черновиком: менеджер набирает
 * состав, правит цены и только потом нажимает «Отправить». До этого момента
 * бумаги для клиента не существует, и увидеть её в своём кабинете он не
 * должен — иначе прочитает цену, которую ему ещё не предлагали.
 *
 * **Фильтр написан ТОЛЬКО про КП, а не «спрятать все черновики».** У остальных
 * типов состояние `draft` недостижимо (`ISSUED_FLOW` в него не ведёт), но
 * общий запрет означал бы, что любой будущий тип со стадией черновика молча
 * исчезнет из клиентского кабинета — и заметят это не мы, а клиент.
 *
 * Стоит в КАНАЛЬНЫХ строителях, а не в списках: каналов три (организация,
 * партнёр, портфель партнёра), и забыть один из них было бы легко.
 */
const CLIENT_HIDDEN_DRAFT_WHERE = {
  NOT: { type: 'commercial_proposal' as const, status: 'draft' },
} as const;

export function organizationChannelWhere(organizationId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'organization',
    counterpartyId: organizationId,
    ...ACTIVE_VERSION_WHERE,
    ...INFECTED_HIDDEN_WHERE,
    ...CLIENT_HIDDEN_DRAFT_WHERE,
  };
}

export function partnerChannelWhere(partnerId: string): Prisma.DocumentWhereInput {
  return {
    counterpartyType: 'partner',
    counterpartyId: partnerId,
    ...ACTIVE_VERSION_WHERE,
    ...INFECTED_HIDDEN_WHERE,
    ...CLIENT_HIDDEN_DRAFT_WHERE,
  };
}

/**
 * `У-155` (решение `Р-18`) — что видит партнёр на вкладке «Документы» карточки
 * организации своего портфеля: свои документы (партнёрский канал) И документы
 * самой организации (счета, акты, договоры клиента).
 *
 * Право даёт **портфель**, а не канал: партнёр ведёт этого клиента. Сам факт
 * принадлежности организации портфелю проверяет вызывающий — здесь только
 * форма выборки. Заражённые файлы скрыты, как и в остальных каналах.
 */
export function partnerPortfolioDocumentsWhere(scope: {
  partnerId: string;
  orgId: string;
}): Prisma.DocumentWhereInput {
  return {
    OR: [
      { counterpartyType: 'partner', counterpartyId: scope.partnerId },
      { counterpartyType: 'organization', counterpartyId: scope.orgId },
    ],
    ...ACTIVE_VERSION_WHERE,
    ...INFECTED_HIDDEN_WHERE,
    ...CLIENT_HIDDEN_DRAFT_WHERE,
  };
}

/**
 * Membership check for a fetched document — used by download guards to return a
 * silent `not_found` when a document is outside the caller's channel (no
 * existence leak).
 */
export function documentInChannel(
  // `У-161`: контрагента может не быть (КП лиду). Такой документ не попадает
  // ни в один клиентский канал — сравнение с `null` даёт `false` само.
  doc: { counterpartyType: CounterpartyType | null; counterpartyId: string | null },
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
  return { orderId: null, companyId, ...ACTIVE_VERSION_WHERE, ...INFECTED_HIDDEN_WHERE };
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
  session: {
    role: string;
    organizationId?: string | null;
    partnerId?: string | null;
    companyId?: string | null;
  },
  // `У-161`: см. `documentInChannel` — документ без контрагента остаётся виден
  // только сотрудникам своей компании, клиентские ветки на `null` не совпадут.
  doc: {
    counterpartyType: CounterpartyType | null;
    counterpartyId: string | null;
    companyId: string | null;
  }
): boolean {
  if (session.role === 'admin') return true;
  // Контур менеджера (Р-Л-4): рядовой и руководитель — company-scoped.
  // Литерал, а не isStaffManagerSide: параметр здесь — структурная выжимка
  // сессии (role: string), не SessionPayload.
  if (session.role === 'manager' || session.role === 'leader') {
    return !!doc.companyId && doc.companyId === session.companyId;
  }
  if (session.role === 'organization') {
    return doc.counterpartyType === 'organization' && doc.counterpartyId === session.organizationId;
  }
  if (session.role === 'partner') {
    return doc.counterpartyType === 'partner' && doc.counterpartyId === session.partnerId;
  }
  return false;
}
