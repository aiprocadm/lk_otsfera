import type { LeadStatus, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { isStaffManagerSide } from '@/lib/auth/roleModel';
import { canSeeOrganization, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { canSeeLead } from '@/lib/auth/accessProfile';

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

/**
 * Кто может выставить коммерческое предложение ЛИДУ (`У-161`, этап 7).
 *
 * Тот же приём, что у организации выше: один источник правды на два входа —
 * сам выпуск (`loadLeadTarget`) и подгрузку панели формы. Разъедься они,
 * форма открывалась бы там, где выпуск запретит, или гейт остался бы только в
 * UI (§4, defense-in-depth).
 *
 * Правила у лида ДРУГИЕ, чем у организации, и это не небрежность:
 *
 * - **компания берётся ИЗ СЕССИИ**, потому что у лида её нет в модели вовсе.
 *   Единственное такое место в проекте; подменить чужую компанию неоткуда —
 *   сотрудник выпускает от имени своей. Отсюда осознанная асимметрия с
 *   организацией: там администратор без своей компании работает (компания
 *   берётся из организации), а лиду он предложение не выставит вовсе —
 *   брать компанию неоткуда, и «выпустить от имени какой-нибудь» хуже отказа;
 * - **cross-company изоляции у лидов нет** — так решено продуктом (лиды
 *   single-tenant, см. шапку `manager/leads.ts`). Поэтому единственная
 *   граница видимости здесь — уровень охвата профиля доступа, `canSeeLead`.
 *   Без него менеджер с профилем «только свои» выпустил бы предложение на
 *   чужого лида, зная лишь его идентификатор: имя и контакт чужого клиента
 *   напечатались бы в его бумаге;
 * - **лид с закрытой судьбой адресатом быть не может.** Отказавшемуся
 *   клиенту предложение не нужно, а переданному в заказ выставляют уже по
 *   заказу — там есть организация, реквизиты и договор. Лид, ставший
 *   сделкой, остаётся допустимым: сделка и есть место, где выставляют КП.
 */
export type LeadIssueScope =
  /**
   * Лид в успехе объявлен ОБЯЗАТЕЛЬНЫМ полем, а не «может быть»: иначе каждый
   * вызывающий писал бы `scope.lead!`, и восклицательный знак означал бы «я
   * верю, что оно есть» вместо проверки компилятором.
   */
  | { ok: true; companyId: string; lead: LeadIssueRow }
  | { ok: false; error: 'forbidden' | 'not_found' | 'no_company' | 'lead_not_active' };

export async function resolveLeadIssueScope(
  prisma: PrismaClient,
  session: SessionPayload,
  leadId: string
): Promise<LeadIssueScope> {
  if (!isStaffManagerSide(session) && session.role !== 'admin')
    return { ok: false, error: 'forbidden' };
  // Своей компании нет — выпускать не от чьего имени. Отдельный код, а не
  // «нет прав»: недостающий доступ сотрудник искал бы у себя напрасно.
  if (!session.companyId) return { ok: false, error: 'no_company' };

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      clientCompanyName: true,
      clientContactName: true,
      organizationId: true,
      assignedManagerId: true,
      status: true,
    },
  });
  if (!lead) return { ok: false, error: 'not_found' };
  // Отказ отдаём как «не найдено»: существование чужого лида наружу не
  // подтверждаем (§4).
  if (!canSeeLead(session, lead)) return { ok: false, error: 'not_found' };
  if (lead.status === 'rejected' || lead.status === 'promoted_to_order')
    return { ok: false, error: 'lead_not_active' };

  return { ok: true, companyId: session.companyId, lead };
}

/** Поля лида, которые нужны и гейту, и форме выпуска. */
type LeadIssueRow = {
  id: string;
  clientCompanyName: string;
  clientContactName: string;
  organizationId: string | null;
  assignedManagerId: string | null;
  /** Объявлен, потому что запрос его берёт и он реально уезжает наружу. */
  status: LeadStatus;
};
