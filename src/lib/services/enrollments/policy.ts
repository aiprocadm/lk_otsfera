import type { PrismaClient } from '@prisma/client';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * T5 enrollment-request RBAC. Reviewers (approve/reject/provision) are our side:
 * managers (incl. leader sub-role) and admins. Submitters are all five roles.
 * Leaders carry the standalone role='leader' (ТЗ 2026-08-17), so the contour branch
 * already covers them.
 */
export function canReviewEnrollments(session: SessionPayload): boolean {
  return session.role === 'admin' || isStaffManagerSide(session);
}

export function canSubmitEnrollments(session: SessionPayload): boolean {
  return (
    session.role === 'partner' ||
    session.role === 'organization' ||
    isStaffManagerSide(session) ||
    session.role === 'admin'
  );
}

/**
 * Скоуп организации для шага 2 мастера заявки (ФТ-2.1): чью «книгу сотрудников»
 * подающему видно. Роли разбираются по убыванию широты доступа:
 * manager/admin — любую; organization — только свои АКТИВНЫЕ членства;
 * partner — только организации своего партнёра (проверяется запросом).
 *
 * Партнёр без `partnerId` уходит в sentinel `__none__`: запрос выполняется, но
 * заведомо ничего не находит — deny-all без отдельной ветки.
 *
 * Сюда доходит только партнёр: гейт `canSubmitEnrollments` в роуте пускает
 * ровно четыре роли, три из них разобраны выше. Отдельная проверка
 * `role === 'partner'` и хвостовой `return false` были бы недостижимы.
 */
export async function canAccessEnrollmentOrg(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string
): Promise<boolean> {
  if (session.role === 'admin' || isStaffManagerSide(session)) return true;
  if (session.role === 'organization') {
    return (session.organizationMemberships ?? []).some(
      (m) => m.isActive && m.organizationId === organizationId
    );
  }
  const org = await prisma.organization.findFirst({
    where: { id: organizationId, partnerId: session.partnerId ?? '__none__' },
    select: { id: true },
  });
  return !!org;
}

/** Snapshot label stored on the request (distinguishes leader from plain manager). */
export function submitterRoleLabel(session: SessionPayload): string {
  if (isManagerLeader(session)) return 'leader';
  return session.role;
}
