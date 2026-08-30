import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { canSeeOrganization, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

/**
 * Кто может выпустить документ **без заказа** для организации (`У-145`).
 *
 * Единственный источник правды на два входа: сам выпуск
 * (`generateOrderDocument`) и подгрузку панели формы. Разъедься они, форма
 * открывалась бы там, где сервер выпуск запретит, — или наоборот, гейт
 * оказался бы только в UI (§4, defense-in-depth).
 *
 * Правило то же, что у карточки организации: админ видит всё, сотрудник ЦО —
 * свою компанию, а вне `teamMode` ещё и только закреплённые за ним
 * организации. Компания берётся **из организации**, а не из формы: подменить
 * её вызовом нельзя.
 */
export type OrgIssueScope =
  | { ok: true; companyId: string }
  | { ok: false; error: 'forbidden' | 'not_found' | 'org_no_company' };

export async function resolveOrgIssueScope(
  prisma: PrismaClient,
  session: SessionPayload,
  organizationId: string
): Promise<OrgIssueScope> {
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { companyId: true },
  });
  if (!org) return { ok: false, error: 'not_found' };
  // Организация-сирота без компании-исполнителя: номер брать не из чего и
  // реквизиты исполнителя неизвестны. Отдельный код, а не «нет доступа», —
  // иначе сотрудник искал бы у себя нехватку прав.
  if (!org.companyId) return { ok: false, error: 'org_no_company' };

  if (isStaffManagerSide(session)) {
    if (session.companyId !== org.companyId) return { ok: false, error: 'not_found' };
    const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
    if (!teamMode && !canSeeOrganization(session, organizationId))
      return { ok: false, error: 'not_found' };
  }

  return { ok: true, companyId: org.companyId };
}
