import type { PrismaClient } from '@prisma/client';

export type OrgCommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  authorName: string;
  orderId: string;
  orderTitle: string;
};

/**
 * Order-comment feed for the partner org-card "Комментарии" tab.
 *
 * SECURITY (Track E / E2-C): scope is the CLIENT `organizationId` — never the
 * seller `companyId`. `Company` is Промтехносфера's own legal entity, shared by
 * every client, so a companyId scope would leak sibling organizations' (and
 * other partners') order conversations. Mirrors the sibling org-card tabs
 * (EmployeesTab/HistoryTab), which scope by `organizationId`.
 */
export async function listOrgOrderComments(
  prisma: PrismaClient,
  args: { orgId: string }
): Promise<OrgCommentRow[]> {
  const rows = await prisma.comment.findMany({
    where: { order: { organizationId: args.orgId } },
    // Этап 10 (§7 ТЗ): явный select вместо include — из Comment берём ровно
    // поля OrgCommentRow, а не всю запись.
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { name: true } },
      order: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    authorName: c.author.name,
    orderId: c.order.id,
    orderTitle: c.order.title,
  }));
}
