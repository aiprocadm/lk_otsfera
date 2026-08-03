import type { PrismaClient } from '@prisma/client';

/**
 * Audit-log feed for the partner org-card "История" tab.
 * Scope is the organization entity itself (entity/entityId), mirroring the
 * sibling org-card tabs (EmployeesTab/CommentsTab).
 */
export async function listOrgHistory(prisma: PrismaClient, args: { orgId: string }) {
  return prisma.auditLog.findMany({
    where: { entity: 'Organization', entityId: args.orgId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}
