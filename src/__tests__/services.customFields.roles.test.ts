/**
 * Этап 1 ТЗ v0.5 (§11) — ролевая видимость и право правки + реестр системных
 * полей. Unit-уровень: чистые модули `roles.ts` / `systemFields.ts` / `entities.ts`.
 *
 * Главная ловушка, которую здесь фиксируем: ПУСТОЙ массив ролей означает
 * «дефолт», а не «никому». Если это когда-нибудь прочтут наоборот, все уже
 * настроенные поля разом станут невидимыми.
 */
import { describe, it, expect } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  CUSTOM_FIELD_ROLES,
  CUSTOM_FIELD_ROLE_LABELS,
  DEFAULT_EDITABLE_ROLES,
  isCustomFieldRole,
  sanitizeRoles,
  sessionFieldRole,
  canRoleSee,
  canRoleEdit,
} from '@/lib/services/customFields/roles';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  isCustomFieldEntity,
} from '@/lib/services/customFields/entities';
import {
  SYSTEM_FIELDS,
  isReservedKey,
  systemFieldsFor,
} from '@/lib/services/customFields/systemFields';

function session(role: string, extra: Partial<SessionPayload> = {}): SessionPayload {
  return { sub: 'u1', role: role as SessionPayload['role'], ...extra } as SessionPayload;
}

describe('roles — роль сессии', () => {
  it('руководитель разворачивается из суб-роли менеджера', () => {
    expect(sessionFieldRole(session('manager', { managerRole: 'leader' }))).toBe('leader');
    expect(sessionFieldRole(session('manager'))).toBe('manager');
  });

  it('top-level роль leader (ТЗ 2026-08-17) даёт то же значение, что старая пара', () => {
    expect(sessionFieldRole(session('leader'))).toBe('leader');
  });

  it('клиентские роли и админ — как есть', () => {
    expect(sessionFieldRole(session('admin'))).toBe('admin');
    expect(sessionFieldRole(session('partner'))).toBe('partner');
    expect(sessionFieldRole(session('organization'))).toBe('organization');
  });

  it('слушатель к настраиваемым полям не относится', () => {
    expect(sessionFieldRole(session('student'))).toBeNull();
  });
});

describe('roles — видимость', () => {
  it('пустой список = видят все, кому доступна карточка (НЕ «никто»)', () => {
    for (const role of CUSTOM_FIELD_ROLES) {
      expect(canRoleSee([], role)).toBe(true);
    }
  });

  it('непустой список — только перечисленные', () => {
    expect(canRoleSee(['admin', 'leader'], 'admin')).toBe(true);
    expect(canRoleSee(['admin', 'leader'], 'manager')).toBe(false);
    expect(canRoleSee(['organization'], 'organization')).toBe(true);
    expect(canRoleSee(['organization'], 'partner')).toBe(false);
  });

  it('роль вне системы (слушатель) не видит ничего', () => {
    expect(canRoleSee([], null)).toBe(false);
    expect(canRoleSee(['admin'], null)).toBe(false);
  });
});

describe('roles — право правки', () => {
  it('пустой список = администратор и руководитель (решение Q1)', () => {
    expect(DEFAULT_EDITABLE_ROLES).toEqual(['admin', 'leader']);
    expect(canRoleEdit([], 'admin')).toBe(true);
    expect(canRoleEdit([], 'leader')).toBe(true);
    expect(canRoleEdit([], 'manager')).toBe(false);
    expect(canRoleEdit([], 'partner')).toBe(false);
    expect(canRoleEdit([], 'organization')).toBe(false);
  });

  it('явный список перекрывает дефолт', () => {
    expect(canRoleEdit(['manager'], 'manager')).toBe(true);
    expect(canRoleEdit(['manager'], 'admin')).toBe(false);
    expect(canRoleEdit(['organization'], 'organization')).toBe(true);
  });

  it('роль вне системы не правит ничего', () => {
    expect(canRoleEdit([], null)).toBe(false);
    expect(canRoleEdit(['admin'], null)).toBe(false);
  });
});

describe('roles — очистка входных данных', () => {
  it('мусор из запроса отбрасывается', () => {
    expect(sanitizeRoles(['admin', 'root', 'student', ''])).toEqual(['admin']);
  });

  it('дубли схлопываются, порядок канонический', () => {
    expect(sanitizeRoles(['manager', 'admin', 'admin'])).toEqual(['admin', 'manager']);
  });

  it('пусто и отсутствие — одинаково', () => {
    expect(sanitizeRoles([])).toEqual([]);
    expect(sanitizeRoles(undefined)).toEqual([]);
    expect(sanitizeRoles(null)).toEqual([]);
  });

  it('isCustomFieldRole различает свои и чужие значения', () => {
    expect(isCustomFieldRole('leader')).toBe(true);
    expect(isCustomFieldRole('student')).toBe(false);
  });

  it('у каждой роли есть русская подпись', () => {
    expect(Object.keys(CUSTOM_FIELD_ROLE_LABELS)).toHaveLength(CUSTOM_FIELD_ROLES.length);
  });
});

describe('entities — закрытый список сущностей', () => {
  it('ровно пять сущностей §11', () => {
    expect([...CUSTOM_FIELD_ENTITIES]).toEqual([
      'order',
      'organization',
      'partner',
      'student',
      'document',
    ]);
  });

  it('чужая строка не проходит', () => {
    expect(isCustomFieldEntity('order')).toBe(true);
    expect(isCustomFieldEntity('other_entity')).toBe(false);
  });

  it('у каждой сущности есть русская подпись', () => {
    for (const e of CUSTOM_FIELD_ENTITIES) {
      expect(CUSTOM_FIELD_ENTITY_LABELS[e].length).toBeGreaterThan(0);
    }
  });
});

describe('systemFields — реестр §11', () => {
  it('организация: пять системных полей из ТЗ', () => {
    expect(systemFieldsFor('organization').map((f) => f.key)).toEqual([
      'name',
      'org_type',
      'partner',
      'assigned_manager',
      'status',
    ]);
  });

  it('сотрудник: три системных поля из ТЗ', () => {
    expect(systemFieldsFor('student').map((f) => f.key)).toEqual([
      'name',
      'organization',
      'status',
    ]);
  });

  it('у заявки, партнёра и документа ТЗ системных полей не называет', () => {
    expect(systemFieldsFor('order')).toEqual([]);
    expect(systemFieldsFor('partner')).toEqual([]);
    expect(systemFieldsFor('document')).toEqual([]);
  });

  it('ключ системного поля зарезервирован — второго «Статуса» не создать', () => {
    expect(isReservedKey('organization', 'status')).toBe(true);
    expect(isReservedKey('student', 'name')).toBe(true);
    // тот же ключ у сущности без системных полей — свободен
    expect(isReservedKey('order', 'status')).toBe(false);
    expect(isReservedKey('organization', 'my_note')).toBe(false);
  });

  it('реестр покрывает все сущности (иначе isReservedKey упадёт)', () => {
    for (const e of CUSTOM_FIELD_ENTITIES) {
      expect(Array.isArray(SYSTEM_FIELDS[e])).toBe(true);
    }
  });

  it('у каждого системного поля есть подпись и источник', () => {
    for (const e of CUSTOM_FIELD_ENTITIES) {
      for (const f of SYSTEM_FIELDS[e]) {
        expect(f.label.length).toBeGreaterThan(0);
        expect(f.source.length).toBeGreaterThan(0);
      }
    }
  });
});
