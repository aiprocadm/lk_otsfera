import type { PrismaClient, AuditLog, Prisma } from '@prisma/client';
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
        action: { in: ['order_status_changed', 'document_uploaded', 'comment_posted'] }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    }),
    prisma.comment.findMany({
      where: { orderId: id },
      include: {
        author: { select: { id: true, name: true, email: true, role: true } }
      },
      orderBy: { createdAt: 'asc' }
    }),
    listOrderItems(prisma, session, { orderId: id })
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
    orderTitle: order.title
  }));

  const items = itemsResult.ok ? itemsResult.items : [];

  return { order, auditEntries, comments, documentRows, items };
}
