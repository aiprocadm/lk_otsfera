import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';

/**
 * M5 — видимость события staff-календаря (спека 2026-07-17-m5-calendar §3).
 * Календарь — внутреннее рабочее пространство (§4 sibling-rule): клиентские роли
 * (partner/organization/student) не видят его НИКОГДА. admin → всё (Model A).
 * Менеджер: company-floor (C8), затем уровень охвата `session.accessProfile?.tasks`
 * (календарь наследует scope задач — v1, см. спеку §6.3): `all`/нет профиля → вся
 * компания; `own`/`assigned` → создатель ∨ участник (у события нет орг-скоупа,
 * поэтому `assigned` тождественен `own`). Deny не leak-аем — caller превращает
 * false в not_found.
 */
export function canSeeEvent(
  session: SessionPayload,
  event: { companyId: string; createdById: string; attendeeUserIds: string[] }
): boolean {
  if (session.role === 'admin') return true;
  if (!isStaffManagerSide(session)) return false;
  // company-floor (C8): чужая компания или сессия без компании — deny.
  if (!session.companyId || event.companyId !== session.companyId) return false;
  const level = session.accessProfile?.tasks;
  if (!level || level === 'all') return true;
  // own | assigned — только своё участие.
  return event.createdById === session.sub || event.attendeeUserIds.includes(session.sub);
}
