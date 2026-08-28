import type { PrismaClient, ExecutionStatus, FinancialStatus, Prisma } from '@prisma/client';
import { orderStage, type Stage } from '@/lib/orders/humanStage';
import { partnerChannelWhere } from '@/lib/auth/documentChannelPolicy';
import type { OrgDocumentRow } from './orgDocuments';

type PartnerOrderDocumentRow = OrgDocumentRow;

export type PartnerOrderCommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

const ORDER_ITEM_INCLUDE = {
  student: { select: { id: true, name: true, email: true } },
  direction: { select: { id: true, name: true } },
  certificate: { select: { id: true, number: true, validUntil: true } },
} satisfies Prisma.OrderItemInclude;

type PartnerOrderItemRow = Prisma.OrderItemGetPayload<{ include: typeof ORDER_ITEM_INCLUDE }>;

export type PartnerOrderDetail = {
  id: string;
  orderNumber: string | null;
  title: string;
  stage: Stage;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  totalAmount: string;
  paidAmount: string;
  debt: string;
  vatIncluded: boolean;
  vatRate: string | null;
  productMix: string[];
  createdAt: Date;
  deadline: Date | null;
  contractSignedAt: Date | null;
  completedAt: Date | null;
  closedAt: Date | null;
  paidAt: Date | null;
  lastSyncedAt: Date | null;
  organization: { id: string; name: string; inn: string | null } | null;
  managerName: string | null;
  documents: PartnerOrderDocumentRow[];
  comments: PartnerOrderCommentRow[];
  items: PartnerOrderItemRow[];
};

export async function getPartnerOrderDetail(
  prisma: PrismaClient,
  args: { orderId: string; partnerId: string }
): Promise<PartnerOrderDetail | null> {
  const order = await prisma.order.findFirst({
    // F2: visible only via the partner's own lead, not legacy Order.partnerId.
    where: { id: args.orderId, promotedFromLead: { partnerId: args.partnerId } },
    // Этап 10 (§7 ТЗ): явный select — клиенту не уезжают внутренние поля заказа
    // (managerId, companyId, 1С-курсоры и т.п.). Список ровно под `PartnerOrderDetail`.
    select: {
      id: true,
      orderNumber: true,
      title: true,
      executionStatus: true,
      financialStatus: true,
      totalAmount: true,
      paidAmount: true,
      vatIncluded: true,
      vatRate: true,
      productMix: true,
      createdAt: true,
      deadline: true,
      contractSignedAt: true,
      completedAt: true,
      closedAt: true,
      paidAt: true,
      lastSyncedAt: true,
      manager: { select: { name: true } },
      // F8: read the order's own organization (exact), not a partner+company lookup
      // that can resolve to the wrong org when two orgs share a company.
      organization: { select: { id: true, name: true, inn: true } },
      documents: {
        where: partnerChannelWhere(args.partnerId),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          type: true,
          direction: true,
          signedAt: true,
          createdAt: true,
          size: true,
          // `У-154`: номер и версия документа — их показывает список.
          number: true,
          version: true,
        },
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      },
      // Позиции заказа целиком клиентские (слушатель, направление, статус,
      // цена) — внутренних полей у OrderItem нет, include безопасен.
      items: {
        include: ORDER_ITEM_INCLUDE,
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!order) return null;

  const org = order.organization;

  const debt = order.totalAmount.minus(order.paidAmount).toFixed(2);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    stage: orderStage({
      executionStatus: order.executionStatus,
      financialStatus: order.financialStatus,
      amount: Number(order.totalAmount),
      paidTotal: Number(order.paidAmount),
    }),
    executionStatus: order.executionStatus,
    financialStatus: order.financialStatus,
    totalAmount: order.totalAmount.toFixed(2),
    paidAmount: order.paidAmount.toFixed(2),
    debt,
    vatIncluded: order.vatIncluded,
    vatRate: order.vatRate ? order.vatRate.toString() : null,
    productMix: order.productMix,
    createdAt: order.createdAt,
    deadline: order.deadline,
    contractSignedAt: order.contractSignedAt,
    completedAt: order.completedAt,
    closedAt: order.closedAt,
    paidAt: order.paidAt,
    lastSyncedAt: order.lastSyncedAt,
    organization: org,
    managerName: order.manager?.name ?? null,
    documents: order.documents.map((d) => ({
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
      number: d.number,
      version: d.version,
    })),
    comments: order.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      authorName: c.author.name,
    })),
    items: order.items,
  };
}
