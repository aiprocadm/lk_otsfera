import { prisma } from '@/lib/db/prisma';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadOrderLessDocument } from '@/lib/auth/documentChannelPolicy';

type AccessErrorCode = 'FORBIDDEN';

type OrderLike = { id: string; companyId: string };
type DocumentLike = {
  id: string;
  orderId: string | null;
  companyId?: string | null;
  order?: { companyId: string } | null;
  // `У-161`: у коммерческого предложения контрагента может не быть — его
  // выставляют лиду, которого ещё нет в системе.
  counterpartyType?: 'organization' | 'partner' | null;
  counterpartyId?: string | null;
  /** `У-164`: черновик КП клиенту не показывается. */
  type?: string | null;
  status?: string | null;
};

export function forbiddenResponse(message = 'Access denied', code: AccessErrorCode = 'FORBIDDEN') {
  return Response.json({ code, message }, { status: 403 });
}

export async function canAccessOrganization(
  session: SessionPayload,
  organizationId: string | null | undefined
) {
  if (!organizationId) return false;
  if (session.role === 'admin') return true;

  if (session.role === 'partner') {
    if (!session.partnerId) return false;
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { partnerId: true },
    });
    return organization?.partnerId === session.partnerId;
  }

  if (session.role === 'organization') {
    return session.organizationId === organizationId;
  }

  if (isStaffManagerSide(session)) {
    const { canSeeOrganization, getCompanyTeamVisibility } =
      await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (teamMode) {
      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { companyId: true },
      });
      return !!session.companyId && org?.companyId === session.companyId;
    }
    return canSeeOrganization(session, organizationId);
  }

  return false;
}

export async function canReadOrder(session: SessionPayload, order: OrderLike) {
  if (session.role === 'admin') return true;

  if (session.role === 'organization') {
    if (!session.organizationId) return false;
    const organizations = await prisma.organization.findMany({
      where: { companyId: order.companyId },
      select: { id: true },
    });
    return organizations.some((org: { id: string }) => org.id === session.organizationId);
  }

  if (session.role === 'partner') {
    if (!session.partnerId) return false;
    const organization = await prisma.organization.findFirst({
      where: { companyId: order.companyId, partnerId: session.partnerId },
      select: { id: true },
    });
    return Boolean(organization);
  }

  if (isStaffManagerSide(session)) {
    const { canSeeOrder, getCompanyTeamVisibility } = await import('@/lib/auth/managerPolicy');
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    // `order` already carries companyId, so company-wide is a pure comparison.
    if (teamMode) return !!session.companyId && order.companyId === session.companyId;
    // Scoped mode: assignment graph only (no comments-history at this guard).
    const fullOrder = await prisma.order.findUnique({
      where: { id: order.id },
      select: { managerId: true, organizationId: true, companyId: true },
    });
    if (!fullOrder) return false;
    return canSeeOrder(session, fullOrder, false);
  }

  return false;
}

export async function canReadDocument(session: SessionPayload, document: DocumentLike) {
  // Re-fetch unless the caller already provided every field both branches need.
  // An order-bound doc is complete when order.companyId is present;
  // an order-less doc is complete only when companyId is present (orderId===null alone
  // is not sufficient — a missing companyId would reach the downstream gate with null).
  const haveAll =
    !!document.counterpartyType &&
    !!document.counterpartyId &&
    (!!document.order?.companyId || !!document.companyId);
  const doc = haveAll
    ? document
    : await prisma.document.findUnique({
        where: { id: document.id },
        select: {
          id: true,
          orderId: true,
          companyId: true,
          counterpartyType: true,
          counterpartyId: true,
          type: true,
          status: true,
          order: { select: { companyId: true } },
        },
      });
  if (!doc) return false;

  /**
   * `У-164`: ЧЕРНОВИК коммерческого предложения клиент не видит и не качает.
   *
   * КП — единственная бумага, которая живёт до отправки: менеджер набирает
   * состав и правит цены, а клиент в это время не должен прочитать цену,
   * которую ему ещё не предложили. Списки прячут такой документ канальным
   * фильтром; здесь закрыта прямая ссылка и скачивание — иначе гейт был бы
   * только в выборке, а адрес документа угадывается по идентификатору.
   *
   * Сотрудников это не касается: черновик — их рабочая бумага.
   *
   * **Тип и состояние обязан прислать вызывающий** — их не добавляли в условие
   * «всё есть», иначе каждый вызов без этих двух полей ходил бы в базу второй
   * раз на ровном месте. Что все вызывающие их запрашивают, проверяет страж
   * `security.document-read-fields.guardrail`: забытое поле означало бы не
   * падение, а молча пропущенный черновик.
   */
  const isProposalDraft = doc.type === 'commercial_proposal' && doc.status === 'draft';
  if (isProposalDraft && (session.role === 'organization' || session.role === 'partner'))
    return false;

  // `У-161`: документ БЕЗ контрагента — это КП, выставленное лиду. Кабинета у
  // такого клиента нет, поэтому клиентские роли его не видят вовсе: сравнивать
  // не с чем. Читают его только сотрудники своей компании — им бумагу надо
  // скачать и отправить руками.
  if (!doc.counterpartyType || !doc.counterpartyId) {
    if (session.role === 'admin') return true;
    if (session.role !== 'manager' && session.role !== 'leader') return false;
    const owner = doc.companyId ?? doc.order?.companyId ?? null;
    return !!owner && owner === session.companyId;
  }

  // Order-less branch: order is null, company anchor lives on the doc.
  if (doc.orderId === null) {
    if (
      canReadOrderLessDocument(session, {
        counterpartyType: doc.counterpartyType,
        counterpartyId: doc.counterpartyId,
        companyId: doc.companyId ?? null,
      })
    )
      return true;
    // `У-155` (решение `Р-18`): партнёр читает документы ОРГАНИЗАЦИЙ своего
    // портфеля. У документов заказа это правило уже действовало; с `У-145`
    // такие документы бывают и без заказа — без этой ветки выпуск из карточки
    // организации создавал бы бумаги, невидимые ведущему клиента партнёру.
    // Проверка асинхронная (портфель + назначенный скоуп), поэтому живёт
    // здесь, а не в чистом `canReadOrderLessDocument`.
    if (session.role === 'partner' && doc.counterpartyType === 'organization')
      return canPartnerAccessOrg(session, doc.counterpartyId);
    return false;
  }

  // Order-bound branch (unchanged from Phase A).
  if (!doc.order?.companyId) return false;

  // Channel isolation for client roles (defense-in-depth at the download gate):
  // a partner reads only its partner-channel; an organization only org-channel.
  // Managers/admins see both channels within their order scope (unchanged).
  if (session.role === 'partner') {
    const ownChannel =
      doc.counterpartyType === 'partner' && doc.counterpartyId === session.partnerId;
    if (!ownChannel) {
      // `У-155` (дефект `Д-15`, решение `Р-18`): партнёр читает и документы
      // ОРГАНИЗАЦИЙ своего портфеля — счета, акты, договоры клиента. Право
      // даёт портфель, а не канал: партнёр ведёт этих клиентов и должен
      // видеть их бумаги. Изоляция здесь же и точная — `canPartnerAccessOrg`
      // сверяет и принадлежность портфелю, и назначенный скоуп; без неё
      // партнёр дотянулся бы до чужой организации той же компании.
      if (doc.counterpartyType !== 'organization') return false;
      if (!(await canPartnerAccessOrg(session, doc.counterpartyId))) return false;
    }
  } else if (session.role === 'organization') {
    // Pin BOTH type and counterpartyId (DOC-01): canReadOrder() below is company-level
    // for orgs and does NOT isolate to a specific organization, so without this an org
    // user could read a sibling org's document within the same company. Symmetric to
    // the partner branch above.
    if (doc.counterpartyType !== 'organization' || doc.counterpartyId !== session.organizationId)
      return false;
  }

  // Pass the parent ORDER id, not the document id: canReadOrder() for the
  // manager role looks the Order up by this id, so passing doc.id silently
  // denied every manager. Both branches carry orderId now.
  return canReadOrder(session, { id: doc.orderId, companyId: doc.order.companyId });
}

export function isPartnerAdmin(session: SessionPayload): boolean {
  return session.role === 'partner' && session.partnerRole === 'admin';
}

export async function canPartnerAccessOrg(
  session: SessionPayload,
  organizationId: string
): Promise<boolean> {
  if (session.role !== 'partner' || !session.partnerId) return false;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { partnerId: true },
  });
  if (!org || org.partnerId !== session.partnerId) return false;

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return true;
  return scope.includes(organizationId);
}

export function partnerOrgScopeFilter(
  session: SessionPayload
): { partnerId: string } | { partnerId: string; id: { in: string[] } } | { id: { in: never[] } } {
  if (!session.partnerId) return { id: { in: [] } };

  const scope = session.assignedOrgIds ?? [];
  if (scope.length === 0) return { partnerId: session.partnerId };
  return { partnerId: session.partnerId, id: { in: scope } };
}
