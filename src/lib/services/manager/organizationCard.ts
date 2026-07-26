import { Prisma, type PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrganization, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { can } from '@/lib/auth/accessProfile';
import { recordPiiAccessMany } from '@/lib/pii/record';

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
  companyId: true,
  partnerCommissionRate: true,
  partner: { select: { id: true, name: true } },
  _count: { select: { orders: true, students: true, users: true } }
} satisfies Prisma.OrganizationSelect;

export type OrgCardOrder = {
  id: string;
  orderNumber: string | null;
  title: string;
  executionStatus: string;
  financialStatus: string;
  totalAmount: string;
  paidAmount: string;
  createdAt: Date;
};
export type OrgCardDocument = { id: string; name: string; type: string; direction: string; createdAt: Date };
export type OrgCardPayment = { id: string; amount: string; paidAt: Date; isRefund: boolean; orderId: string | null };
export type OrgCardComment = { id: string; body: string; createdAt: Date; authorName: string; orderId: string };
export type OrgCardInboundMessage = {
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
export type OrgCardCall = {
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
export type OrgCardClientRequest = { id: string; subject: string; status: string; rejectedReason: string | null; createdAt: Date };
export type OrgCardLead = { id: string; subject: string; status: string; createdAt: Date };
export type OrgCardDeal = { id: string; title: string; status: string; amount: string | null; createdAt: Date };

export type OrganizationCard = {
  id: string;
  name: string;
  inn: string | null;
  kpp: string | null;
  partner: { id: string; name: string } | null;
  counts: { orders: number; students: number; users: number };
  kpis: { activeOrders: number; totalPaid: string; totalRefunded: string };
  orders: OrgCardOrder[];
  documents: OrgCardDocument[];
  payments: OrgCardPayment[];
  activity: OrgCardComment[];
  inboundMessages: OrgCardInboundMessage[];
  calls: OrgCardCall[];
  clientRequests: OrgCardClientRequest[];
  leads: OrgCardLead[];
  deals: OrgCardDeal[];
  // null в менеджерском контуре (нет capability see_commission).
  commission: { partnerCommissionRate: string | null } | null;
};

export async function getOrganizationCard(
  prisma: PrismaClient,
  session: SessionPayload,
  orgId: string
): Promise<OrganizationCard | null> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: CARD_SELECT });
  if (!org) return null;
  // Scope-guard (не leak-аем существование чужой орг).
  const visible = teamMode
    ? !!session.companyId && org.companyId === session.companyId
    : canSeeOrganization(session, orgId);
  if (!visible) return null;

  const [orders, activeOrders, documents, payments, paidAgg, refundAgg, activity, inboundMessages, calls, clientRequests, leads, deals] = await Promise.all([
    prisma.order.findMany({
      where: { organizationId: orgId },
      select: {
        id: true, orderNumber: true, title: true, executionStatus: true,
        financialStatus: true, totalAmount: true, paidAmount: true, createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.order.count({ where: { organizationId: orgId, executionStatus: { in: ['pending', 'in_progress', 'on_hold'] } } }),
    prisma.document.findMany({
      where: { order: { organizationId: orgId }, scanStatus: { not: 'infected' } },
      select: { id: true, name: true, type: true, direction: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.payment.findMany({
      where: { organizationId: orgId },
      select: { id: true, amount: true, paidAt: true, isRefund: true, orderId: true },
      orderBy: { paidAt: 'desc' },
      take: 20
    }),
    prisma.payment.aggregate({ where: { organizationId: orgId, isRefund: false }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { organizationId: orgId, isRefund: true }, _sum: { amount: true } }),
    prisma.comment.findMany({
      where: { order: { organizationId: orgId } },
      select: { id: true, body: true, createdAt: true, orderId: true, author: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.inboundMessage.findMany({
      where: { resolvedOrgId: orgId },
      select: {
        id: true, channel: true, senderRef: true, senderDisplay: true, subject: true,
        body: true, createdAt: true, status: true, scanStatus: true, attachmentName: true
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    // Не селектим `recordingPath` — карточке нужен только boolean hasRecording,
    // сырой object-storage путь не должен уходить в RSC-payload (mirrors listCalls.ts).
    prisma.call.findMany({
      where: { resolvedOrgId: orgId },
      select: {
        id: true, direction: true, callerNumber: true, internalNumber: true, status: true,
        durationSec: true, startedAt: true, createdAt: true, resolvedOrgId: true,
        recordingScanStatus: true, recordingPath: true
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    // Этап 7 (PR-3): внутренний контур — заявки клиентов / лиды / сделки организации.
    prisma.clientRequest.findMany({
      where: { organizationId: orgId },
      select: { id: true, subject: true, status: true, rejectedReason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.lead.findMany({
      where: { organizationId: orgId },
      select: { id: true, subject: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    }),
    prisma.deal.findMany({
      where: { organizationId: orgId },
      select: { id: true, title: true, status: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 20
    })
  ]);

  const paid = paidAgg._sum.amount ?? new Prisma.Decimal(0);
  const refunded = refundAgg._sum.amount ?? new Prisma.Decimal(0);

  await recordPiiAccessMany(prisma, [
    {
      session,
      context: 'org_card_inbound',
      subjectIds: inboundMessages.map((m) => m.id)
    },
    {
      session,
      context: 'org_card_calls',
      subjectIds: calls.map((c) => c.id)
    }
  ]);

  return {
    id: org.id,
    name: org.name,
    inn: org.inn,
    kpp: org.kpp,
    partner: org.partner,
    counts: { orders: org._count.orders, students: org._count.students, users: org._count.users },
    kpis: {
      activeOrders,
      totalPaid: paid.minus(refunded).toFixed(2),
      totalRefunded: refunded.toFixed(2)
    },
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      title: o.title,
      executionStatus: o.executionStatus,
      financialStatus: o.financialStatus,
      totalAmount: o.totalAmount.toFixed(2),
      paidAmount: o.paidAmount.toFixed(2),
      createdAt: o.createdAt
    })),
    documents: documents.map((d) => ({ id: d.id, name: d.name, type: d.type, direction: d.direction, createdAt: d.createdAt })),
    payments: payments.map((p) => ({ id: p.id, amount: p.amount.toFixed(2), paidAt: p.paidAt, isRefund: p.isRefund, orderId: p.orderId })),
    activity: activity.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, authorName: c.author.name, orderId: c.orderId })),
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
      attachmentName: m.attachmentName
    })),
    calls: calls.map(({ recordingPath, ...c }) => ({
      ...c,
      hasRecording: recordingPath != null
    })),
    clientRequests: clientRequests.map((r) => ({
      id: r.id, subject: r.subject, status: r.status, rejectedReason: r.rejectedReason, createdAt: r.createdAt
    })),
    leads: leads.map((l) => ({ id: l.id, subject: l.subject, status: l.status, createdAt: l.createdAt })),
    deals: deals.map((d) => ({
      id: d.id, title: d.title, status: d.status, amount: d.amount ? d.amount.toFixed(2) : null, createdAt: d.createdAt
    })),
    commission: can(session, 'see_commission')
      ? { partnerCommissionRate: org.partnerCommissionRate ? org.partnerCommissionRate.toFixed(4) : null }
      : null
  };
}
