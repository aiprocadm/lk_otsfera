import type { PrismaClient, ExecutionStatus, FinancialStatus } from '@prisma/client';
import { orderStage, type Stage } from '@/lib/orders/humanStage';
import { partnerChannelWhere } from '@/lib/auth/documentChannelPolicy';
import type { OrgDocumentRow } from './orgDocuments';

export type DealDocumentRow = OrgDocumentRow;

export type DealCommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
};

export type DealDetail = {
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
  documents: DealDocumentRow[];
  comments: DealCommentRow[];
};

export async function getPartnerDealDetail(
  prisma: PrismaClient,
  args: { dealId: string; partnerId: string }
): Promise<DealDetail | null> {
  const order = await prisma.order.findFirst({
    where: { id: args.dealId, partnerId: args.partnerId },
    include: {
      manager: { select: { name: true } },
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
          size: true
        }
      },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { name: true } } }
      }
    }
  });

  if (!order) return null;

  const org = await prisma.organization.findFirst({
    where: { partnerId: args.partnerId, companyId: order.companyId },
    select: { id: true, name: true, inn: true }
  });

  const debt = (Number(order.totalAmount) - Number(order.paidAmount)).toFixed(2);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    title: order.title,
    stage: orderStage({
      executionStatus: order.executionStatus,
      financialStatus: order.financialStatus,
      amount: Number(order.totalAmount),
      paidTotal: Number(order.paidAmount)
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
      orderTitle: order.title
    })),
    comments: order.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      authorName: c.author.name
    }))
  };
}
