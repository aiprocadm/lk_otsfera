import type { ThreadSide } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isOrgMember } from '@/lib/auth/organizationPolicy';

export type ThreadOrder = {
  id: string;
  organizationId: string | null;
  partnerId: string | null;
  companyId: string | null;
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
  // Командная видимость: admin видит всё (Model A); менеджер видит обе стороны,
  // но ТОЛЬКО внутри своей компании — cross-company изоляция (инвариант C8)
  // держится независимо от managerTeamVisibility. companyId=null → deny
  // (как sentinel-ветки в managerPolicy: деградация в «ничего», не в «всё»).
  if (session.role === 'admin') return true;
  if (session.role === 'manager') {
    return !!session.companyId && order.companyId === session.companyId;
  }
  if (session.role === 'organization') {
    return side === 'org' && !!order.organizationId && isOrgMember(session, order.organizationId);
  }
  if (session.role === 'partner') {
    return side === 'partner' && !!order.partnerId && session.partnerId === order.partnerId;
  }
  return false;
}
