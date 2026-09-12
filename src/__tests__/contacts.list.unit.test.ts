import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  CONTACT_LIST_PAGE,
  contactSearchWhere,
  listContacts,
  phoneDigitsCandidates,
} from '@/lib/services/contacts/list';
import { contactScopeWhere } from '@/lib/services/contacts/scope';

/**
 * Список контактов (этап 1 ТЗ 12.09.2026, спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3 и §3.9):
 * право → скоуп → фильтры → сортировка → страница по 50 с честным `total`;
 * поиск находит контакт по имени, организации, почте и телефону в любом
 * написании («+7 (921)…», «8921…», «921 123»); просмотр списка — чтение ПДн
 * (`contacts_list`, §3.10).
 */
const findMany = vi.fn();
const count = vi.fn();
const prisma = { contact: { findMany, count } } as unknown as PrismaClient;

const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const manager = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;

const rows = [
  { id: 'k1', name: 'Иван', organization: null, channels: [], isArchived: false },
  { id: 'k2', name: 'Пётр', organization: null, channels: [], isArchived: false },
];

describe('phoneDigitsCandidates', () => {
  it('короче пяти цифр — не телефон; «8…» даёт два варианта; иначе один', () => {
    expect(phoneDigitsCandidates('Иван 1234')).toEqual([]);
    expect(phoneDigitsCandidates('abc')).toEqual([]);
    expect(phoneDigitsCandidates('+7 (921) 12')).toEqual(['792112']);
    expect(phoneDigitsCandidates('8921 123')).toEqual(['8921123', '921123']);
  });
});

describe('contactSearchWhere', () => {
  it('строка короче двух символов после обрезки — null', () => {
    expect(contactSearchWhere(' И ')).toBeNull();
    expect(contactSearchWhere('')).toBeNull();
  });

  it('текст без телефона — имя, организация и почта (почта в нижнем регистре)', () => {
    expect(contactSearchWhere(' Иван@Test ')).toEqual({
      OR: [
        { name: { contains: 'Иван@Test', mode: 'insensitive' } },
        { organization: { is: { name: { contains: 'Иван@Test', mode: 'insensitive' } } } },
        { channels: { some: { type: 'email', normalizedValue: { contains: 'иван@test' } } } },
      ],
    });
  });

  it('телефон через «8» — два кандидата цифр по каналам phone/whatsapp', () => {
    const where = contactSearchWhere('8 (921) 123-45-67');
    expect(where?.OR).toHaveLength(5);
    expect(where?.OR?.slice(3)).toEqual([
      {
        channels: {
          some: {
            type: { in: ['phone', 'whatsapp'] },
            normalizedValue: { contains: '89211234567' },
          },
        },
      },
      {
        channels: {
          some: {
            type: { in: ['phone', 'whatsapp'] },
            normalizedValue: { contains: '9211234567' },
          },
        },
      },
    ]);
  });

  it('строка режется до 100 символов — длинный ввод не уходит в базу целиком', () => {
    const where = contactSearchWhere('а'.repeat(150));
    const first = where?.OR?.[0] as { name: { contains: string } };
    expect(first.name.contains).toHaveLength(100);
  });
});

describe('listContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue(rows);
    count.mockResolvedValue(7);
  });

  it('клиентская роль → forbidden без единого запроса и без записи ПДн', async () => {
    await expect(listContacts(prisma, partner, true)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });

  it('без фильтров: пол компании, активные, по имени, первая страница, ПДн с hasQuery=false', async () => {
    const r = await listContacts(prisma, admin, true);
    expect(r).toEqual({ ok: true, items: rows, total: 7, page: 1, pageSize: CONTACT_LIST_PAGE });
    const where = { AND: [{ companyId: 'c1' }, { isArchived: false }] };
    expect(findMany).toHaveBeenCalledWith({
      where,
      select: expect.objectContaining({ id: true, name: true, position: true }),
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: CONTACT_LIST_PAGE,
    });
    expect(count).toHaveBeenCalledWith({ where });
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: admin,
      context: 'contacts_list',
      subjectIds: ['k1', 'k2'],
      meta: { take: CONTACT_LIST_PAGE, hasQuery: false },
    });
  });

  it('все фильтры разом: скоуп менеджера без команды, с организацией, поиск, по обновлению, 3-я страница', async () => {
    const r = await listContacts(prisma, manager, false, {
      q: '8 (921) 123-45-67',
      scope: 'with_org',
      sort: 'updated',
      page: 3,
      organizationId: 'o1',
    });
    expect(r).toMatchObject({ ok: true, page: 3 });
    const call = findMany.mock.calls[0][0];
    expect(call.where.AND).toEqual([
      contactScopeWhere(manager, false),
      { isArchived: false, organizationId: { not: null } },
      { organizationId: 'o1' },
      contactSearchWhere('8 (921) 123-45-67'),
    ]);
    expect(call.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'asc' }]);
    expect(call.skip).toBe(2 * CONTACT_LIST_PAGE);
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ meta: { take: CONTACT_LIST_PAGE, hasQuery: true } })
    );
  });

  it('вкладки «в архиве» и «без организации» дают свои фильтры', async () => {
    await listContacts(prisma, admin, true, { scope: 'archived' });
    expect(findMany.mock.calls[0][0].where.AND[1]).toEqual({ isArchived: true });
    await listContacts(prisma, admin, true, { scope: 'without_org' });
    expect(findMany.mock.calls[1][0].where.AND[1]).toEqual({
      isArchived: false,
      organizationId: null,
    });
  });

  it('страница меньше 1 и дробная — приводится; короткий поиск не становится фильтром', async () => {
    let r = await listContacts(prisma, admin, true, { page: 0, q: 'И' });
    expect(r).toMatchObject({ ok: true, page: 1 });
    expect(findMany.mock.calls[0][0].skip).toBe(0);
    expect(findMany.mock.calls[0][0].where.AND).toHaveLength(2);
    expect(recordPiiAccess).toHaveBeenLastCalledWith(
      prisma,
      expect.objectContaining({ meta: { take: CONTACT_LIST_PAGE, hasQuery: false } })
    );

    r = await listContacts(prisma, admin, true, { page: 2.9, q: '' });
    expect(r).toMatchObject({ ok: true, page: 2 });
    expect(findMany.mock.calls[1][0].skip).toBe(CONTACT_LIST_PAGE);
    expect(findMany.mock.calls[1][0].where.AND).toHaveLength(2);
  });
});
