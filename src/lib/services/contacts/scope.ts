import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { can, NO_COMPANY_SENTINEL } from '@/lib/auth/accessProfile';
import { isOrgInScope, managerOrgScope } from '@/lib/auth/managerPolicy';
import { isManagerLeader, isStaffManagerSide } from '@/lib/auth/roleModel';

/**
 * Скоуп контактов (этап 1 ТЗ 12.09.2026, `У-187`, спека §3.1) — единственный
 * источник правды «какие контакты сотрудник видит и может трогать».
 *
 * Правило. Контакт принадлежит компании-продавцу (`companyId` — пол, страховка
 * `'__no_company__'`). **Контакт с организацией виден тем, кому видна
 * организация** (`managerOrgScope`: командная видимость, закрепления и охват
 * `organizations` профиля доступа работают автоматически). **Контакт без
 * организации** («с улицы») виден всем сотрудникам компании — закреплять его
 * не за что, а невидимый контакт хуже видимого (умолчание `В-1-1`).
 * Администратор — пол компании (Model A). Руководитель без профиля видит всю
 * компанию независимо от `teamMode` (лидер-инвариант C8, как в `createContact`).
 *
 * `teamMode` — обязательный параметр без значения по умолчанию: пропуск молча
 * сужал бы выборку до закреплённых организаций (урок CLAUDE.md §16); страж
 * `auth.teamMode-required.guardrail` держит это и для этого файла.
 *
 * ВАЖНО: `contactScopeWhere` (Prisma) и `isContactInScope` (in-memory) обязаны
 * означать одно и то же — меняются вместе; матрица эквивалентности живёт в
 * `src/__tests__/contacts.scope.unit.test.ts`.
 */

/** Форма контакта, достаточная для проверки скоупа в памяти. */
export type ContactScopeShape = { companyId: string; organizationId: string | null };

/**
 * Право пользоваться справочником (`crm.contacts`, спека §3.2): администратор
 * и сотрудники менеджерского контура своей компании; сессия без профиля —
 * доступ есть (тождество no-profile прежних прав), с профилем — только при
 * наличии права. Клиентский контур — никогда.
 */
export function canUseContacts(session: SessionPayload): boolean {
  if (!session.companyId) return false;
  if (session.role === 'admin') return true;
  if (!isStaffManagerSide(session)) return false;
  if (!session.accessProfile) return true;
  return can(session, 'crm.contacts');
}

/** Руководитель без профиля видит всю компанию — закрепления его не касаются. */
function companyWide(session: SessionPayload): boolean {
  return session.role === 'admin' || (isManagerLeader(session) && !session.accessProfile);
}

/** Prisma-форма скоупа (списки, счётчики, поиск). */
export function contactScopeWhere(
  session: SessionPayload,
  teamMode: boolean
): Prisma.ContactWhereInput {
  const floor = { companyId: session.companyId ?? NO_COMPANY_SENTINEL };
  if (companyWide(session)) return floor;
  return {
    AND: [
      floor,
      { OR: [{ organizationId: null }, { organization: managerOrgScope(session, teamMode) }] },
    ],
  };
}

/** In-memory форма для уже загруженного контакта (карточка, мутации). */
export function isContactInScope(
  session: SessionPayload,
  teamMode: boolean,
  contact: ContactScopeShape
): boolean {
  if (!session.companyId || contact.companyId !== session.companyId) return false;
  if (companyWide(session)) return true;
  if (contact.organizationId === null) return true;
  const level = session.accessProfile?.organizations;
  if (level) return level === 'all' || isOrgInScope(session, contact.organizationId);
  return teamMode || isOrgInScope(session, contact.organizationId);
}

/**
 * Можно ли привязать контакт к организации (создание, правка): организация
 * своей компании и в охвате сотрудника. Зеркало проверки в `createContact`.
 */
export function canBindOrganization(
  session: SessionPayload,
  teamMode: boolean,
  org: { id: string; companyId: string | null }
): boolean {
  // Организация без компании (историческая запись) никому не «своя».
  if (!org.companyId) return false;
  return isContactInScope(session, teamMode, { companyId: org.companyId, organizationId: org.id });
}
