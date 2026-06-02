import type { ThreadSide } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isOrgMember } from '@/lib/auth/organizationPolicy';

export type ThreadOrder = {
  id: string;
  organizationId: string | null;
  partnerId: string | null;
};

/** Внешняя сторона выводится из роли; команда (manager/admin) выбирает сторону явно. */
export function deriveSide(session: SessionPayload): ThreadSide | null {
  if (session.role === 'organization') return 'org';
  if (session.role === 'partner') return 'partner';
  return null;
}

export function canSeeThread(
  session: SessionPayload,
  side: ThreadSide,
  order: ThreadOrder
): boolean {
  // Командная видимость: любой менеджер/руководитель/админ видит обе стороны.
  if (session.role === 'manager' || session.role === 'admin') return true;
  if (session.role === 'organization') {
    return side === 'org' && !!order.organizationId && isOrgMember(session, order.organizationId);
  }
  if (session.role === 'partner') {
    return side === 'partner' && !!order.partnerId && session.partnerId === order.partnerId;
  }
  return false;
}
