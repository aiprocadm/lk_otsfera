/**
 * §11 ТЗ v0.5 — роли для видимости и права правки настраиваемого поля.
 *
 * Это НЕ `Role` из jwt.ts: руководитель там не отдельная роль, а суб-роль
 * менеджера (`managerRole='leader'`, §4 CLAUDE.md). Для настройки полей
 * заказчику нужно различать менеджера и руководителя, поэтому здесь свой
 * плоский список из пяти значений. Слушателя нет: у него нет карточек (§14 ТЗ).
 */

import type { SessionPayload } from '@/lib/auth/jwt';
import { isManagerLeader } from '@/lib/auth/managerPolicy';

export const CUSTOM_FIELD_ROLES = [
  'admin',
  'leader',
  'manager',
  'partner',
  'organization'
] as const;

export type CustomFieldRole = (typeof CUSTOM_FIELD_ROLES)[number];

export const CUSTOM_FIELD_ROLE_LABELS: Record<CustomFieldRole, string> = {
  admin: 'Администратор',
  leader: 'Руководитель',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Организация'
};

/**
 * Роли, которые правят поле, когда `editableByRoles` пуст.
 *
 * Решение заказчика Q1 (29.07.2026): администратор и руководитель. Менеджер и
 * клиенты — только чтение, пока роль не отмечена явно.
 *
 * Внимание: определения, созданные ДО этапа 1, получили явный
 * ['admin','leader','manager'] в миграции — этот дефолт их не касается.
 */
export const DEFAULT_EDITABLE_ROLES: readonly CustomFieldRole[] = ['admin', 'leader'];

export function isCustomFieldRole(value: string): value is CustomFieldRole {
  return (CUSTOM_FIELD_ROLES as readonly string[]).includes(value);
}

/** Отбрасывает мусор из массива ролей, пришедшего из запроса. */
export function sanitizeRoles(values: string[] | undefined | null): CustomFieldRole[] {
  if (!values) return [];
  const seen = new Set<CustomFieldRole>();
  for (const v of values) {
    if (isCustomFieldRole(v)) seen.add(v);
  }
  return CUSTOM_FIELD_ROLES.filter((r) => seen.has(r));
}

/**
 * Роль сессии в терминах настраиваемых полей.
 *
 * Руководитель приходит как role='manager' + managerRole='leader', поэтому
 * разворачиваем его в отдельное значение. Слушатель к полям не допускается.
 */
export function sessionFieldRole(session: SessionPayload): CustomFieldRole | null {
  switch (session.role) {
    case 'admin':
      return 'admin';
    case 'manager':
      return isManagerLeader(session) ? 'leader' : 'manager';
    case 'partner':
      return 'partner';
    case 'organization':
      return 'organization';
    default:
      return null; // student
  }
}

/** Видит ли роль поле. Пустой `visibleToRoles` = видят все, кому доступна карточка. */
export function canRoleSee(visibleToRoles: string[], role: CustomFieldRole | null): boolean {
  if (visibleToRoles.length === 0) return role !== null;
  return role !== null && visibleToRoles.includes(role);
}

/** Правит ли роль поле. Пустой `editableByRoles` = DEFAULT_EDITABLE_ROLES. */
export function canRoleEdit(editableByRoles: string[], role: CustomFieldRole | null): boolean {
  if (role === null) return false;
  const allowed = editableByRoles.length === 0 ? DEFAULT_EDITABLE_ROLES : editableByRoles;
  return (allowed as readonly string[]).includes(role);
}
