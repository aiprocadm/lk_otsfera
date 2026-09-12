import { describe, it, expect } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  canBindOrganization,
  canUseContacts,
  contactScopeWhere,
  isContactInScope,
} from '@/lib/services/contacts/scope';

/**
 * Матрица эквивалентности скоупа контактов (этап 1 ТЗ 12.09.2026, `У-187`,
 * спека §3.1): Prisma-форма `contactScopeWhere` и in-memory двойник
 * `isContactInScope` обязаны давать один вердикт на каждой комбинации
 * роль × профиль × teamMode × контакт. Where оценивается структурным
 * интерпретатором известных форм — незнакомая форма роняет тест, а не
 * молча оценивается в false (образец `services.inbound.scope.unit.test.ts`).
 */

const COMPANY = 'A';
const MANAGED = ['o1'];

type Profile = 'none' | 'all' | 'assigned' | 'own';

function session(
  role: 'admin' | 'manager' | 'leader',
  profile: Profile,
  companyId: string | null = COMPANY
) {
  const base = { sub: 'u1', role, companyId, managedOrgIds: MANAGED } as unknown as SessionPayload;
  if (profile === 'none') return base;
  return {
    ...base,
    accessProfile: { id: 'p', name: 'p', organizations: profile, capabilities: ['crm.contacts'] },
  } as unknown as SessionPayload;
}

/** Контакт с его организацией — организация той же компании (инвариант createContact). */
type ContactRow = { companyId: string; organizationId: string | null };

const CONTACTS: ContactRow[] = [
  { companyId: 'A', organizationId: null },
  { companyId: 'A', organizationId: 'o1' },
  { companyId: 'A', organizationId: 'o2' },
  { companyId: 'B', organizationId: 'o3' },
];

/** Оценка `OrganizationWhereInput` из managerOrgScope для организации контакта. */
function orgMatches(where: Prisma.OrganizationWhereInput, contact: ContactRow): boolean {
  if (contact.organizationId === null) return false;
  const org = { id: contact.organizationId, companyId: contact.companyId };
  const keys = Object.keys(where);
  if (keys.length === 1 && keys[0] === 'AND') {
    return (where.AND as Prisma.OrganizationWhereInput[]).every((w) => orgMatches(w, contact));
  }
  if (keys.length === 1 && keys[0] === 'companyId') return org.companyId === where.companyId;
  if (keys.length === 1 && keys[0] === 'id') {
    const idf = where.id as { in: string[] };
    return idf.in.includes(org.id);
  }
  throw new Error(`неизвестная форма OrganizationWhereInput: ${JSON.stringify(where)}`);
}

function matchesWhere(where: Prisma.ContactWhereInput, contact: ContactRow): boolean {
  const keys = Object.keys(where);
  if (keys.length === 1 && keys[0] === 'companyId') return contact.companyId === where.companyId;
  if (keys.length === 1 && keys[0] === 'AND') {
    return (where.AND as Prisma.ContactWhereInput[]).every((w) => matchesWhere(w, contact));
  }
  if (keys.length === 1 && keys[0] === 'OR') {
    return (where.OR as Prisma.ContactWhereInput[]).some((w) => matchesWhere(w, contact));
  }
  if (keys.length === 1 && keys[0] === 'organizationId')
    return contact.organizationId === where.organizationId;
  if (keys.length === 1 && keys[0] === 'organization') {
    return orgMatches(where.organization as Prisma.OrganizationWhereInput, contact);
  }
  throw new Error(`неизвестная форма ContactWhereInput: ${JSON.stringify(where)}`);
}

describe('contactScopeWhere ↔ isContactInScope', () => {
  const sessions: Array<[string, SessionPayload]> = [
    ['admin', session('admin', 'none')],
    ['manager без профиля', session('manager', 'none')],
    ['leader без профиля', session('leader', 'none')],
    ['manager, профиль all', session('manager', 'all')],
    ['manager, профиль assigned', session('manager', 'assigned')],
    ['manager, профиль own', session('manager', 'own')],
    ['leader, профиль assigned', session('leader', 'assigned')],
    ['manager без компании', session('manager', 'none', null)],
  ];

  it('обе формы совпадают на всей матрице (8 сессий × 2 режима × 4 контакта)', () => {
    let checked = 0;
    for (const [, s] of sessions) {
      for (const teamMode of [true, false]) {
        const where = contactScopeWhere(s, teamMode);
        for (const c of CONTACTS) {
          expect(isContactInScope(s, teamMode, c)).toBe(matchesWhere(where, c));
          checked += 1;
        }
      }
    }
    expect(checked).toBe(64);
  });

  it.each([
    [
      'контакт без организации виден рядовому менеджеру без команды',
      session('manager', 'none'),
      false,
      CONTACTS[0]!,
      true,
    ],
    ['закреплённая организация — виден', session('manager', 'none'), false, CONTACTS[1]!, true],
    [
      'незакреплённая без команды — не виден',
      session('manager', 'none'),
      false,
      CONTACTS[2]!,
      false,
    ],
    ['незакреплённая с командой — виден', session('manager', 'none'), true, CONTACTS[2]!, true],
    ['чужая компания — не виден даже админу', session('admin', 'none'), true, CONTACTS[3]!, false],
    [
      'руководитель без профиля видит всю компанию и без команды',
      session('leader', 'none'),
      false,
      CONTACTS[2]!,
      true,
    ],
    [
      'руководитель с профилем assigned сужен профилем',
      session('leader', 'assigned'),
      true,
      CONTACTS[2]!,
      false,
    ],
    [
      'профиль all — вся компания при выключенной команде',
      session('manager', 'all'),
      false,
      CONTACTS[2]!,
      true,
    ],
    ['профиль own — только закреплённые', session('manager', 'own'), true, CONTACTS[2]!, false],
    [
      'сессия без компании не видит ничего',
      session('manager', 'none', null),
      true,
      CONTACTS[0]!,
      false,
    ],
  ])('%s', (_name, s, teamMode, contact, expected) => {
    expect(isContactInScope(s, teamMode, contact)).toBe(expected);
    expect(matchesWhere(contactScopeWhere(s, teamMode), contact)).toBe(expected);
  });

  it('сессия без компании получает страховочный sentinel, а не пустой фильтр', () => {
    const where = contactScopeWhere(session('manager', 'none', null), true);
    expect(JSON.stringify(where)).toContain('__no_company__');
    expect(JSON.stringify(where)).not.toContain('"companyId":null');
  });
});

describe('canUseContacts (право crm.contacts, спека §3.2)', () => {
  it('admin и сотрудники без профиля — можно; клиентские роли — нельзя', () => {
    expect(canUseContacts(session('admin', 'none'))).toBe(true);
    expect(canUseContacts(session('manager', 'none'))).toBe(true);
    expect(canUseContacts(session('leader', 'none'))).toBe(true);
    for (const role of ['partner', 'organization', 'student']) {
      expect(
        canUseContacts({ sub: 'u', role, companyId: COMPANY } as unknown as SessionPayload)
      ).toBe(false);
    }
  });

  it('профиль без права — нельзя, с правом — можно; без компании — нельзя никому', () => {
    const noRight = {
      ...session('manager', 'all'),
      accessProfile: { id: 'p', name: 'p', organizations: 'all', capabilities: [] },
    } as unknown as SessionPayload;
    expect(canUseContacts(noRight)).toBe(false);
    expect(canUseContacts(session('manager', 'all'))).toBe(true);
    expect(canUseContacts(session('admin', 'none', null))).toBe(false);
    expect(canUseContacts(session('manager', 'none', null))).toBe(false);
  });
});

describe('canBindOrganization', () => {
  it('своя закреплённая — да; незакреплённая без команды — нет; чужая компания и без компании — нет', () => {
    const s = session('manager', 'none');
    expect(canBindOrganization(s, false, { id: 'o1', companyId: 'A' })).toBe(true);
    expect(canBindOrganization(s, false, { id: 'o2', companyId: 'A' })).toBe(false);
    expect(canBindOrganization(s, true, { id: 'o2', companyId: 'A' })).toBe(true);
    expect(canBindOrganization(s, true, { id: 'o3', companyId: 'B' })).toBe(false);
    expect(canBindOrganization(s, true, { id: 'o9', companyId: null })).toBe(false);
  });
});
