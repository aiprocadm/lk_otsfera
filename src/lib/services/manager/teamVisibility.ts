import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Flip the company-wide manager visibility toggle. Idempotent: a no-op flip
 * writes no audit row. Callers (leader/admin server-actions) own authorization.
 */
export async function setTeamVisibility(
  prisma: PrismaClient,
  actorUserId: string,
  companyId: string,
  enabled: boolean
): Promise<{ ok: true; changed: boolean } | { ok: false; error: 'company_not_found' }> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { managerTeamVisibility: true }
  });
  if (!company) return { ok: false, error: 'company_not_found' };
  if (company.managerTeamVisibility === enabled) return { ok: true, changed: false };

  await prisma.company.update({
    where: { id: companyId },
    data: { managerTeamVisibility: enabled }
  });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'manager_team_visibility_changed',
    entity: 'company',
    entityId: companyId,
    before: { managerTeamVisibility: company.managerTeamVisibility },
    after: { managerTeamVisibility: enabled }
  });
  return { ok: true, changed: true };
}
