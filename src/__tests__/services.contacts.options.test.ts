import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import { listContactOptions } from '@/lib/services/contacts/options';
import { contactScopeWhere } from '@/lib/services/contacts/scope';

/**
 * Варианты контактов для чужих форм (этап 1 ТЗ 12.09.2026, `У-180` «контакт из
 * всех точек»): форма сделки и «Контакт заказа» предлагают ровно тех людей,
 * которых сотрудник видит в справочнике (`contactScopeWhere` — настоящий, не
 * мок), без архива; с `organizationId` — только контакты этой организации.
 * Чтение имён — событие ПДн `contacts_options` (§25.7); пустая выдача события
 * не даёт.
 */

const findMany = vi.fn();
const prisma = { contact: { findMany } } as unknown as PrismaClient;

const ADMIN = { sub: 'a1', role: 'admin', companyId: 'c1' } as SessionPayload;
const LEADER = { sub: 'l1', role: 'leader', companyId: 'c1' } as SessionPayload;
const MANAGER = {
  sub: 'm1',
  role: 'manager',
  companyId: 'c1',
  managedOrgIds: ['o1'],
} as SessionPayload;
const PARTNER = { sub: 'p1', role: 'partner', companyId: 'c1' } as SessionPayload;
const NO_COMPANY = { sub: 'm0', role: 'manager' } as SessionPayload;
const NO_RIGHT = {
  ...MANAGER,
  accessProfile: { id: 'p', name: 'p', organizations: 'all', capabilities: [] },
} as unknown as SessionPayload;

const ROWS = [
  { id: 'k1', name: 'Иванов', position: 'директор', organizationId: 'o1' },
  { id: 'k2', name: 'Петров', position: null, organizationId: null },
];

/** Первый элемент `AND` — скоуп справочника; второй — «не архив»; третий — организация. */
function whereOf(): { AND: unknown[] } {
  return (findMany.mock.calls[0]![0] as { where: { AND: unknown[] } }).where;
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue(ROWS);
});

describe('listContactOptions — право на справочник', () => {
  it('клиентская роль, сессия без компании и профиль без права → пустой список, база не опрашивается', async () => {
    expect(await listContactOptions(prisma, PARTNER, true)).toEqual([]);
    expect(await listContactOptions(prisma, NO_COMPANY, true)).toEqual([]);
    expect(await listContactOptions(prisma, NO_RIGHT, true)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});

describe('listContactOptions — форма запроса', () => {
  it('администратор без фильтра: пол компании + не архив, без условия по организации; сортировка и предел 500', async () => {
    // Фильтры не переданы вовсе — работает значение по умолчанию.
    const r = await listContactOptions(prisma, ADMIN, false);
    expect(r).toEqual(ROWS);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { AND: [{ companyId: 'c1' }, { isArchived: false }] },
      select: { id: true, name: true, position: true, organizationId: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  });

  it('с organizationId — третьим условием добавляется организация (карточка заказа)', async () => {
    await listContactOptions(prisma, ADMIN, false, { organizationId: 'o7' });
    expect(whereOf().AND).toEqual([
      { companyId: 'c1' },
      { isArchived: false },
      { organizationId: 'o7' },
    ]);
  });

  it('organizationId: undefined явно — условия по организации нет (форма сделки без организации)', async () => {
    await listContactOptions(prisma, ADMIN, false, { organizationId: undefined });
    expect(whereOf().AND).toHaveLength(2);
    expect(JSON.stringify(whereOf())).not.toContain('organizationId');
  });

  it('рядовой менеджер без команды — скоуп справочника: закреплённые организации + «с улицы»', async () => {
    await listContactOptions(prisma, MANAGER, false);
    const scope = whereOf().AND[0];
    expect(scope).toEqual(contactScopeWhere(MANAGER, false));
    // Скоуп действительно сужает: в нём закреплённая организация и «без организации».
    expect(JSON.stringify(scope)).toContain('"in":["o1"]');
    expect(JSON.stringify(scope)).toContain('"organizationId":null');
    expect(whereOf().AND[1]).toEqual({ isArchived: false });
  });

  it('рядовой менеджер с командой — пол компании, закрепления не участвуют', async () => {
    await listContactOptions(prisma, MANAGER, true);
    expect(whereOf().AND[0]).toEqual(contactScopeWhere(MANAGER, true));
    expect(JSON.stringify(whereOf().AND[0])).not.toContain('"in":["o1"]');
  });

  it('руководитель без профиля — пол компании при любом режиме команды', async () => {
    await listContactOptions(prisma, LEADER, false);
    expect(whereOf().AND[0]).toEqual({ companyId: 'c1' });
    findMany.mockClear();
    await listContactOptions(prisma, LEADER, true);
    expect(whereOf().AND[0]).toEqual({ companyId: 'c1' });
  });
});

describe('listContactOptions — событие ПДн', () => {
  it('непустая выдача — одно событие contacts_options с id всех строк; строки отдаются как есть', async () => {
    const r = await listContactOptions(prisma, MANAGER, true, { organizationId: 'o1' });
    expect(r).toEqual(ROWS);
    expect(recordPiiAccess).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).toHaveBeenCalledWith(prisma, {
      session: MANAGER,
      context: 'contacts_options',
      subjectIds: ['k1', 'k2'],
    });
  });

  it('пустая выдача — события ПДн нет', async () => {
    findMany.mockResolvedValue([]);
    expect(await listContactOptions(prisma, ADMIN, true)).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});
