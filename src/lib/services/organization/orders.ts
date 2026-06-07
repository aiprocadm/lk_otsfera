import type {
  PrismaClient,
  ExecutionStatus,
  FinancialStatus,
  DocumentType,
  DocumentDirection
} from '@prisma/client';
import { humanStage, type Stage } from '@/lib/orders/humanStage';
import { organizationChannelWhere } from '@/lib/auth/documentChannelPolicy';

export type OrgOrderRow = {
  id: string;
  orderNumber: string | null;
  title: string;
  totalAmount: string;
  paidAmount: string;
  debt: string;
  executionStatus: ExecutionStatus;
  financialStatus: FinancialStatus;
  stage: Stage;
  createdAt: Date;
  deadline: Date | null;
  managerName: string | null;
};

export type ListOrgOrdersOptions = {
  organizationId: string;
  executionStatus?: ExecutionStatus;
  financialStatus?: FinancialStatus;
  search?: string;
  take?: number;
  skip?: number;
};

export type ListOrgOrdersResult = {
  rows: OrgOrderRow[];
  total: number;
};

const DEFAULT_TAKE = 25;
const MAX_TAKE = 100;

function normalizeTake(take: number | undefined): number {
  if (take === undefined) return DEFAULT_TAKE;
  if (!Number.isFinite(take) || take <= 0) return DEFAULT_TAKE;
  return Math.min(Math.floor(take), MAX_TAKE);
}

function normalizeSkip(skip: number | undefined): number {
  if (skip === undefined) return 0;
  if (!Number.isFinite(skip) || skip < 0) return 0;
  return Math.floor(skip);
}

export async function listOrgOrders(
  prisma: PrismaClient,
  opts: ListOrgOrdersOptions
): Promise<ListOrgOrdersResult> {
  const take = normalizeTake(opts.take);
  const skip = normalizeSkip(opts.skip);

  const where = {
    organizationId: opts.organizationId,
    ...(opts.executionStatus ? { executionStatus: opts.executionStatus } : {}),
    ...(opts.financialStatus ? { financialStatus: opts.financialStatus } : {}),
    ...(opts.search
      ? {
          OR: [
            { title: { contains: opts.search, mode: 'insensitive' as const } },
            { orderNumber: { contains: opts.search, mode: 'insensitive' as const } }
          ]
        }
      : {})
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take,
      skip,
      select: {
        id: true,
        orderNumber: true,
        title: true,
        totalAmount: true,
        paidAmount: true,
        executionStatus: true,
        financialStatus: true,
        createdAt: true,
        deadline: true,
        manager: { select: { name: true } }
      }
    })
  ]);

  const rows: OrgOrderRow[] = orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    title: o.title,
    totalAmount: o.totalAmount.toFixed(2),
    paidAmount: o.paidAmount.toFixed(2),
    debt: (Number(o.totalAmount) - Number(o.paidAmount)).toFixed(2),
    executionStatus: o.executionStatus,
    financialStatus: o.financialStatus,
    stage: humanStage({
      executionStatus: o.executionStatus,
      financialStatus: o.financialStatus
    }),
    createdAt: o.createdAt,
    deadline: o.deadline,
    managerName: o.manager?.name ?? null
  }));

  return { rows, total };
}

export type OrgOrderDocument = {
  id: string;
  name: string;
  type: DocumentType;
  direction: DocumentDirection;
  signedAt: Date | null;
  createdAt: Date;
  size: number | null;
  orderId: string;
  orderNumber: string | null;
  orderTitle: string;
};

export type OrgOrderPayment = {
  id: string;
  amount: string;
  paidAt: Date;
  method: string | null;
  isRefund: boolean;
  note: string | null;
};

export type OrgOrderDetail = {
  id: string;
  organizationId: string;
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
  managerName: string | null;
  documents: OrgOrderDocument[];
  payments: OrgOrderPayment[];
  commentsCount: number;
};

export async function getOrgOrder(
  prisma: PrismaClient,
  organizationId: string,
  orderId: string
): Promise<OrgOrderDetail | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      manager: { select: { name: true } },
      documents: {
        where: organizationChannelWhere(organizationId),
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
      payments: {
        orderBy: { paidAt: 'desc' },
        select: {
          id: true,
          amount: true,
          paidAt: true,
          method: true,
          isRefund: true,
          note: true
        }
      },
      _count: { select: { comments: true } }
    }
  });

  if (!order) return null;
  if (order.organizationId !== organizationId) return null;

  return {
    id: order.id,
    organizationId: order.organizationId,
    orderNumber: order.orderNumber,
    title: order.title,
    stage: humanStage({
      executionStatus: order.executionStatus,
      financialStatus: order.financialStatus
    }),
    executionStatus: order.executionStatus,
    financialStatus: order.financialStatus,
    totalAmount: order.totalAmount.toFixed(2),
    paidAmount: order.paidAmount.toFixed(2),
    debt: (Number(order.totalAmount) - Number(order.paidAmount)).toFixed(2),
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
    payments: order.payments.map((p) => ({
      id: p.id,
      amount: p.amount.toFixed(2),
      paidAt: p.paidAt,
      method: p.method,
      isRefund: p.isRefund,
      note: p.note
    })),
    commentsCount: order._count.comments
  };
}
