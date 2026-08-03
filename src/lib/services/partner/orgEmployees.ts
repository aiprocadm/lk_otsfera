import type { PrismaClient } from '@prisma/client';

/**
 * Active employee list for the partner org-card "Сотрудники" tab.
 * Scope is the client `organizationId`, mirroring the sibling org-card tabs
 * (CommentsTab/HistoryTab).
 */
export async function listOrgEmployees(prisma: PrismaClient, args: { orgId: string }) {
  return prisma.organizationUser.findMany({
    where: { organizationId: args.orgId, isActive: true },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'asc' },
  });
}
