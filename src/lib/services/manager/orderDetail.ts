import type { PrismaClient, AuditLog, Prisma, DealStatus } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { getOrder, type ManagerOrderDetail } from '@/lib/services/manager/orders';
import type { OrgDocumentRow } from '@/lib/services/partner/orgDocuments';
import { listOrderItems, type OrderItemRow } from '@/lib/services/training';

type CommentWithAuthor = Prisma.CommentGetPayload<{
  include: { author: { select: { id: true; name: true; email: true; role: true } } };
}>;

export type ManagerOrderDetailData = {
  order: ManagerOrderDetail;
  auditEntries: AuditLog[];
  comments: CommentWithAuthor[];
  documentRows: OrgDocumentRow[];
  items: OrderItemRow[];
};

export async function loadManagerOrderDetail(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<ManagerOrderDetailData | null> {
  const order = await getOrder(prisma, session, id);
  if (!order) return null;

  // Audit + comment loads run in parallel: timeline shows the audit slice
  // (manager-order-timeline filters out partner-economics rows), and the
  // bottom card renders the existing comments read-only until Task 25/31
  // wires the manager-side comments thread + posting in Phase 8.4.
  const [auditEntries, comments, itemsResult] = await Promise.all([
    prisma.auditLog.findMany({
      where: {
        entityId: id,
        entity: 'order',
        action: { in: ['order_status_changed', 'document_uploaded', 'comment_posted'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.comment.findMany({
      where: { orderId: id },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    listOrderItems(prisma, session, { orderId: id }),
  ]);

  // The DocumentsList client component expects the partner/org doc row shape
  // (it carries the order metadata used in its sub-label). The manager service
  // returns raw Document[] — fold the per-order context in here.
  const documentRows: OrgDocumentRow[] = order.documents.map((d) => ({
    id: d.id,
    name: d.name,
    type: d.type,
    direction: d.direction,
    signedAt: d.signedAt,
    createdAt: d.createdAt,
    size: d.size,
    orderId: order.id,
    orderNumber: order.orderNumber,
    orderTitle: order.title,
  }));

  const items = itemsResult.ok ? itemsResult.items : [];

  return { order, auditEntries, comments, documentRows, items };
}

export type OrderStudentOption = { id: string; name: string; email: string | null };

/**
 * Слушатели для селектов форм карточки заказа (позиции обучения).
 *
 * Скоуп наследуется от самой карточки: страница вызывает это только после
 * `loadManagerOrderDetail` → `getOrder` → `canSeeOrder` (C8, teamMode-aware), а
 * `organizationId` берётся из уже проверенного заказа. Отдельной проверки прав
 * здесь нет намеренно — вызывать сервис с произвольной организацией нельзя.
 *
 * `organizationId = null` — защитная ветка: на странице она была записана как
 * `organizationId ?? undefined`, то есть «фильтра нет» (для Prisma `undefined`
 * и отсутствующий ключ — одно и то же). Здесь это записано пустым `where`:
 * поведение то же, но проходит `exactOptionalPropertyTypes`. В реальных данных
 * `Order.organizationId` не бывает null — ветка остаётся страховкой.
 */
export async function listOrderStudentOptions(
  prisma: PrismaClient,
  organizationId: string | null
): Promise<OrderStudentOption[]> {
  const where: Prisma.StudentWhereInput = organizationId === null ? {} : { organizationId };
  return prisma.student.findMany({
    where,
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
}

export type OrderDeal = {
  id: string;
  title: string;
  /** Строкой (`toFixed(2)`) — как на доске сделок: Decimal до клиента не доезжает. */
  amount: string | null;
  status: DealStatus;
  wonAt: Date | null;
  stageName: string | null;
  managerName: string | null;
  lead: {
    id: string;
    clientCompanyName: string;
    sourceRequest: { id: string; subject: string } | null;
  } | null;
} | null;

/**
 * Кому какие сделки видны. Union, а не `string | null`, намеренно: «смотреть
 * без границы компании» нельзя получить случайно — это надо попросить словом
 * `allCompanies`. С `string | null` сотрудник без компании (`companyId` в
 * сессии пуст) молча проваливался бы в админский режим, то есть деградировал
 * бы в «видно всё» вместо «ничего» — против канона проекта (sentinel-ветки
 * `managerPolicy` и `chat/policy.ts`).
 */
export type OrderDealScope = { allCompanies: true } | { companyId: string };

/**
 * Сделка, из которой вырос заказ. Обслуживает двух потребителей одним
 * запросом: хлебные крошки «обращение → лид → сделка» (этап 11 PR-2, ФТ-15.6)
 * и панель «Сделка» на карточке заказа (19.08.2026, спека
 * `2026-08-19-order-deal-link-design.md`).
 *
 * `scope` — граница изоляции C8 (§4 CLAUDE.md). Доступ к самому заказу
 * страница уже проверила политикой, но связь 1:1 не доказывает, что сделка
 * той же компании: данные могли разъехаться импортом. `allCompanies` просит
 * только админ — он по Model A видит всё.
 */
export async function loadOrderDeal(
  prisma: PrismaClient,
  orderId: string,
  scope: OrderDealScope
): Promise<OrderDeal> {
  const deal = await prisma.deal.findFirst({
    where: { orderId, ...('companyId' in scope ? { companyId: scope.companyId } : {}) },
    select: {
      id: true,
      title: true,
      amount: true,
      status: true,
      wonAt: true,
      stage: { select: { name: true } },
      manager: { select: { name: true } },
      lead: {
        select: {
          id: true,
          clientCompanyName: true,
          sourceRequest: { select: { id: true, subject: true } },
        },
      },
    },
  });
  if (!deal) return null;
  return {
    id: deal.id,
    title: deal.title,
    amount: deal.amount ? deal.amount.toFixed(2) : null,
    status: deal.status,
    wonAt: deal.wonAt,
    stageName: deal.stage?.name ?? null,
    managerName: deal.manager?.name ?? null,
    lead: deal.lead,
  };
}
