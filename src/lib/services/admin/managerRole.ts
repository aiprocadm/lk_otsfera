import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

export type SetManagerRoleResult =
  { ok: true; changed: boolean } | { ok: false; error: 'user_not_found' | 'not_a_manager' };

/**
 * Grant ('leader') or revoke (null) the manager leader sub-role. Admin-only
 * (the privesc boundary): the server-action gates with requireAdmin so a leader
 * can never promote anyone, including themselves.
 */
export async function setManagerRole(
  prisma: PrismaClient,
  actorUserId: string,
  targetUserId: string,
  role: 'leader' | null
): Promise<SetManagerRoleResult> {
  const user = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { role: true, managerRole: true },
  });
  if (!user) return { ok: false, error: 'user_not_found' };
  if (user.role !== 'manager') return { ok: false, error: 'not_a_manager' };
  if (user.managerRole === role) return { ok: true, changed: false };

  await prisma.user.update({ where: { id: targetUserId }, data: { managerRole: role } });
  await recordAudit(prisma, {
    userId: actorUserId,
    action: 'manager_role_changed',
    entity: 'user',
    entityId: targetUserId,
    before: { managerRole: user.managerRole },
    after: { managerRole: role },
  });
  return { ok: true, changed: true };
}
