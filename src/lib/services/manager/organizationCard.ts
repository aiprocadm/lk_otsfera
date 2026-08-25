import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  canSeeOrganization,
  getCompanyTeamVisibility,
  isLeaderSameCompany,
} from '@/lib/auth/managerPolicy';
import { can } from '@/lib/auth/accessProfile';
import { activeOrgIds } from '@/lib/auth/organizationPolicy';
import { recordPiiAccessMany } from '@/lib/pii/record';
import { listCertificates } from '@/lib/services/training/certificates';

/**
 * G4 — CRM-карточка организации: центральный накопитель истории (заявки,
 * документы, оплаты, переписка, реквизиты). Видна только внутри компании
 * (admin/leader/manager по scope). Company-scope + существующие guard'ы
 * (`canSeeOrganization`, teamMode C8): чужая орг → null (не leak-аем).
 * Комиссия скрыта в менеджерском контуре (§3.4): `commission` = null без
 * capability `see_commission`. Деньги — строки (Decimal не уходит в RSC-payload).
 */

const CARD_SELECT = {
  id: true,
  name: true,
  inn: true,
  kpp: true,
  // Этап 8 (ФТ-9.2): полный набор реквизитов для read-only таба.
  legalName: true,
  ogrn: true,
  legalAddress: true,
  bankName: true,
  bankAccount: true,
  corrAccount: true,
  bic: true,
  signerName: true,
  signerPosition: true,
  signerBasis: true,
  companyId: true,
  partnerCommissionRate: true,
  // `У-99`: на вкладке «Настройки» рядом со ставкой видно её основание —
  // иначе человек видит число и не знает, откуда оно взялось.
  partnerCommissionRateNote: true,
  partnerId: true,
  partner: { select: { id: true, name: true } },
  // `У-102`/`Д-29`: «Доступ в кабинет» считается по активным
  // `OrganizationUser`, а НЕ по связи `Organization.users`
  // (`User.organizationId`) — из-за неё менеджер и админ показывали разные
  // числа про один и тот же объект.
  _count: {
    select: {
      orders: true,
      students: true,
      organizationUsers: { where: { isActive: true } },
    },
  },
} satisfies Prisma.OrganizationSelect;

type OrgCardOrder = {
  id: string;
  orderNumber: string | null;
  title: string;
  executionStatus: string;
  financialStatus: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: Date;
};
type OrgCardDocument = {
  id: string;
  name: string;
  type: string;
  direction: string;
  createdAt: Date;
};
type OrgCardPayment = {
  id: string;
  amount: string;
  paidAt: Date;
  isRefund: boolean;
  orderId: string | null;
};
type OrgCardComment = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
  orderId: string;
};
type OrgCardInboundMessage = {
  id: string;
  channel: string;
  senderRef: string;
  senderDisplay: string | null;
  subject: string | null;
  body: string;
  createdAt: Date;
  status: string;
  scanStatus: string;
  attachmentName: string | null;
};
type OrgCardCall = {
  id: string;
  direction: string;
  callerNumber: string;
  internalNumber: string | null;
  status: string;
  durationSec: number | null;
  startedAt: Date | null;
  createdAt: Date;
  resolvedOrgId: string | null;
  recordingScanStatus: string;
  hasRecording: boolean;
};

// Этап 7 (PR-3, §9 этапа 7): внутренний контур в карточке организации.
type OrgCardClientRequest = {
  id: string;
  subject: string;
  status: string;
  rejectedReason: string | null;
  createdAt: Date;
};
type OrgCardLead = { id: string; subject: string; status: string; createdAt: Date };
type OrgCardDeal = {
  id: string;
  title: string;
  status: string;
  amount: string | null;
  createdAt: Date;
};

/**
 * `У-96`: вкладка «Заявки на обучение» — список слушателей, которых надо
 * обучить. Раньше в карточке организации её не было: заявки клиента жили
 * только в своём разделе, и менеджер не видел их рядом с историей клиента.
 */
type OrgCardEnrollment = {
  id: string;
  status: string;
  createdAt: Date;
  courseTitle: string | null;
  studentsCount: number;
};

/**
 * `У-96`: вкладка «История» — журнал действий по организации. До этого шага
 * «Историей» называлась сводка последних событий, а настоящего журнала в
 * карточке не было вовсе: кто и когда правил реквизиты или ставку, приходилось
 * искать в общем журнале аудита.
 */
type OrgCardAuditEntry = {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
};

// Этап 9 (ФТ-12.2, PR-3): вкладка «Удостоверения» карточки + её выгрузка.
type OrgCardCertificate = {
  id: string;
  number: string;
  studentName: string;
  directionName: string;
  issuedAt: Date;
  validUntil: Date | null;
  hasScan: boolean;
};

type OrgCardRequisites = {
  legalName: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
  signerBasis: string | null;
};

export type OrganizationCard = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  requisites: OrgCardRequisites;
  partner: { id: string; name: string } | null;
  counts: { orders: number; students: number; cabinetUsers: number };
  kpis: { activeOrders: number; totalPaid: string; totalRefunded: string; debt: string };
  orders: OrgCardOrder[];
  documents: OrgCardDocument[];
  payments: OrgCardPayment[];
  activity: OrgCardComment[];
  inboundMessages: OrgCardInboundMessage[];
  calls: OrgCardCall[];
  clientRequests: OrgCardClientRequest[];
  leads: OrgCardLead[];
  deals: OrgCardDeal[];
  certificates: OrgCardCertificate[];
  enrollments: OrgCardEnrollment[];
  /** Пустой у клиентских ролей: журнал действий — внутренняя информация ЦО. */
  auditTrail: OrgCardAuditEntry[];
  // null в менеджерском контуре (нет capability see_commission).
  commission: { partnerCommissionRate: string | null; note: string | null } | null;
};

export async function getOrganizationCard(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<OrganizationCard | null> {
  // Карточку открывают все пять кабинетов, и граница у каждого своя:
  //  · заказчик (`У-100`) — активное членство в организации;
  //  · партнёр (`У-96`) — организация его портфеля;
  //  · сотрудники ЦО — менеджерский скоуп с режимом видимости команды (C8).
  // `isStaffView` решает не «пускать ли», а «какие блоки грузить»: внутренние
  // данные учебного центра клиентским ролям не показывают вовсе.
  const isStaffView = session.role !== 'organization' && session.role !== 'partner';
  // Платежи организации — не партнёрское дело: у него своя комиссия, а вкладки
  // «Оплаты» реестр ему не даёт. Раньше карточка партнёра их и не грузила.
  const seesPayments = session.role !== 'partner';
  const teamMode = isStaffView ? await getCompanyTeamVisibility(prisma, session.companyId) : false;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: CARD_SELECT });
  if (!org) return null;
  // Scope-guard (не leak-аем существование чужой орг).
  // Лидер-инвариант C8: руководитель видит организацию СВОЕЙ компании без
  // закрепления. В PR #273 правило добавили только в гард страницы, а сервис
  // карточки продолжал фильтровать по закреплению — гард пускал, карточка
  // отдавала null, и страница показывала «не найдено». Поймано живой проверкой
  // на стенде 30.07.2026.
  const visible = session.role === 'organization'
    ? activeOrgIds(session).includes(orgId)
    : session.role === 'partner'
      ? // Принадлежность портфелю — по БД, а не по сессии: список организаций
        // в токене устаревает, привязка к партнёру — нет. Дополнительный
        // персональный скоуп (`assignedOrgIds`) сужает её ещё раз.
        !!session.partnerId &&
        org.partnerId === session.partnerId &&
        ((session.assignedOrgIds ?? []).length === 0 ||
          (session.assignedOrgIds ?? []).includes(orgId))
      : teamMode
      ? !!session.companyId && org.companyId === session.companyId
      : canSeeOrganization(session, orgId) || isLeaderSameCompany(session, org.companyId);
  if (!visible) return null;

  const [
    orders,
    activeOrders,
    documents,
    payments,
    paidAgg,
    refundAgg,
    activity,
    enrollments,
    certificatesRes,
  ] = await Promise.all([
    prisma.order.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        orderNumber: true,
        title: true,
        executionStatus: true,
        financialStatus: true,
        totalAmount: true,
        paidAmount: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.order.count({
      where: {
        organizationId: orgId,
        executionStatus: { in: ['pending', 'in_progress', 'on_hold'] },
      },
    }),
    prisma.document.findMany({
      where: { order: { organizationId: orgId }, scanStatus: { not: 'infected' } },
      select: { id: true, name: true, type: true, direction: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    seesPayments
      ? prisma.payment.findMany({
          where: { organizationId: orgId },
          select: { id: true, amount: true, paidAt: true, isRefund: true, orderId: true },
          orderBy: { paidAt: 'desc' },
          take: 20,
        })
      : [],
    seesPayments
      ? prisma.payment.aggregate({
          where: { organizationId: orgId, isRefund: false },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } },
    seesPayments
      ? prisma.payment.aggregate({
          where: { organizationId: orgId, isRefund: true },
          _sum: { amount: true },
        })
      : { _sum: { amount: null } },
    prisma.comment.findMany({
      where: { order: { organizationId: orgId } },
      select: {
        id: true,
        body: true,
        createdAt: true,
        orderId: true,
        author: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // `У-96`: заявки на обучение этой организации — вкладка карточки.
    prisma.enrollmentRequest.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        status: true,
        createdAt: true,
        legacyCourseTitle: true,
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    // Этап 9 (ФТ-12.2): вкладка «Удостоверения». Идём через сервис реестра, а
    // не прямым запросом — он пересекает orgId со скоупом сессии и сам пишет
    // PiiAccessEvent `certificates_list` (§12: ФИО слушателей — ПДн).
    listCertificates(prisma, session, { organizationId: orgId, take: 20 }),
  ]);

  // `У-100`: заказчику эти блоки не показывают вовсе (реестр вкладок
  // отдаёт «Входящие письма», «Звонки», «Обращения», «Лиды» и «Сделки»
  // только сотрудникам учебного центра). Раньше они всё равно грузились бы
  // и уехали бы в браузер заказчика вместе с карточкой — вкладки нет, а
  // данные есть. Поэтому запросы выполняются только для staff-просмотра.
  // `У-96`: журнал действий по организации. Кто и что менял — внутренняя
  // информация учебного центра, клиенту и партнёру её не показывают, поэтому и
  // не грузим.
  const auditTrail = isStaffView
    ? await prisma.auditLog.findMany({
        where: { entity: 'organization', entityId: orgId },
        select: {
          id: true,
          action: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
    : [];

  // `У-96`: вкладка «Обращения» положена и партнёру, поэтому запрос живёт
  // отдельно от внутренних блоков учебного центра.
  const clientRequests =
    session.role !== 'organization'
      ? await prisma.clientRequest.findMany({
          where: { organizationId: orgId },
          select: { id: true, subject: true, status: true, rejectedReason: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
      : [];

  const [inboundMessages, calls, leads, deals] = isStaffView
    ? await Promise.all([
      prisma.inboundMessage.findMany({
        where: { resolvedOrgId: orgId },
        select: {
          id: true,
          channel: true,
          senderRef: true,
          senderDisplay: true,
          subject: true,
          body: true,
          createdAt: true,
          status: true,
          scanStatus: true,
          attachmentName: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // Не селектим `recordingPath` — карточке нужен только boolean hasRecording,
      // сырой object-storage путь не должен уходить в RSC-payload (mirrors listCalls.ts).
      prisma.call.findMany({
        where: { resolvedOrgId: orgId },
        select: {
          id: true,
          direction: true,
          callerNumber: true,
          internalNumber: true,
          status: true,
          durationSec: true,
          startedAt: true,
          createdAt: true,
          resolvedOrgId: true,
          recordingScanStatus: true,
          recordingPath: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      // Этап 7 (PR-3): внутренний контур — лиды и сделки организации.
      prisma.lead.findMany({
        where: { organizationId: orgId },
        select: { id: true, subject: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      prisma.deal.findMany({
        where: { organizationId: orgId },
        select: { id: true, title: true, status: true, amount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      ])
    : ([[], [], [], []] as const);

  const paid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
  const refunded = refundAgg._sum.amount ?? new Prisma.Decimal(0);
  // `У-102`: «Задолженность» — сумма `totalAmount − paidAmount` по заказам
  // организации. Считается здесь, чтобы плитка во всех кабинетах брала одно и
  // то же число (реестр `orgCardTiles`).
  const debt = orders
    .reduce((acc, o) => acc.plus(o.totalAmount).minus(o.paidAmount), new Prisma.Decimal(0))
    .toFixed(2);

  await recordPiiAccessMany(prisma, [
    {
      session,
      context: 'org_card_inbound',
      subjectIds: inboundMessages.map((m) => m.id),
    },
    {
      session,
      context: 'org_card_calls',
      subjectIds: calls.map((c) => c.id),
    },
  ]);

  // Причина ignore: listCertificates не возвращает ошибок для read-скоупа —
  // запасная ветка недостижима, оставлена ради полноты Result-типа.
  /* v8 ignore next */
  const certificateRows = certificatesRes.ok ? certificatesRes.certificates : [];

  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    kpp: org.kpp,
    requisites: {
      legalName: org.legalName,
      ogrn: org.ogrn,
      legalAddress: org.legalAddress,
      bankName: org.bankName,
      bankAccount: org.bankAccount,
      corrAccount: org.corrAccount,
      bic: org.bic,
      signerName: org.signerName,
      signerPosition: org.signerPosition,
      signerBasis: org.signerBasis,
    },
    partner: org.partner,
    counts: {
      orders: org._count.orders,
      students: org._count.students,
      cabinetUsers: org._count.organizationUsers,
    },
    kpis: {
      activeOrders,
      totalPaid: paid.minus(refunded).toFixed(2),
      totalRefunded: refunded.toFixed(2),
      debt,
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      title: o.title,
      executionStatus: o.executionStatus,
      financialStatus: o.financialStatus,
      totalAmount: o.totalAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2),
      createdAt: o.createdAt,
    })),
    documents: documents.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      direction: d.direction,
      createdAt: d.createdAt,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amount: p.amount.toFixed(2),
      paidAt: p.paidAt,
      isRefund: p.isRefund,
      orderId: p.orderId,
    })),
    activity: activity.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      authorName: c.author.name,
      orderId: c.orderId,
    })),
    inboundMessages: inboundMessages.map((m) => ({
      id: m.id,
      channel: m.channel,
      senderRef: m.senderRef,
      senderDisplay: m.senderDisplay,
      subject: m.subject,
      body: m.body,
      createdAt: m.createdAt,
      status: m.status,
      scanStatus: m.scanStatus,
      attachmentName: m.attachmentName,
    })),
    calls: calls.map(({ recordingPath, ...c }) => ({
      ...c,
      hasRecording: recordingPath != null,
    })),
    clientRequests: clientRequests.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      rejectedReason: r.rejectedReason,
      createdAt: r.createdAt,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      subject: l.subject,
      status: l.status,
      createdAt: l.createdAt,
    })),
    certificates: certificateRows.map((c) => ({
      id: c.id,
      number: c.number,
      studentName: c.student.name,
      directionName: c.direction.name,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil,
      hasScan: c.documentId != null,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      amount: d.amount ? d.amount.toFixed(2) : null,
      createdAt: d.createdAt,
    })),
    enrollments: enrollments.map((e) => ({
      id: e.id,
      status: e.status,
      createdAt: e.createdAt,
      courseTitle: e.legacyCourseTitle,
      studentsCount: e._count.items,
    })),
    auditTrail: auditTrail.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt,
      actorName: a.user.name,
    })),
    commission:
      isStaffView && can(session, 'see_commission')
      ? {
          partnerCommissionRate: org.partnerCommissionRate
            ? org.partnerCommissionRate.toFixed(4)
            : null,
          note: org.partnerCommissionRateNote,
        }
      : null,
  };
}
