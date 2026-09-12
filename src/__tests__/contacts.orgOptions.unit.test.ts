import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managerOrgScope } from '@/lib/auth/managerPolicy';
import { listContactOrgOptions } from '@/lib/services/contacts/orgOptions';

/**
 * Организации для привязки контакта (этап 1 ТЗ 12.09.2026, `У-180`; спека
 * docs/superpowers/specs/2026-09-12-stage1-contacts-and-notes-design.md §3.3):
 * форма предлагает ровно те организации, что видит справочник сотрудника —
 * администратор и руководитель без профиля получают пол компании, менеджер
 * (и руководитель с профилем) — пересечение пола с `managerOrgScope`; без
 * компании в сессии — пустой список без похода в базу.
 */
const findMany = vi.fn();
const prisma = { organization: { findMany } } as unknown as PrismaClient;

const ROWS = [
  { id: 'o1', name: 'Лютик' },
  { id: 'o2', name: 'Ромашка' },
];

function session(extra: Partial<SessionPayload>): SessionPayload {
  return { sub: 'u1', companyId: 'c1', managedOrgIds: ['o1'], ...extra } as SessionPayload;
}

const PROFILE = {
  id: 'p1',
  name: 'Профиль',
  organizations: 'assigned',
  capabilities: ['crm.contacts'],
} as unknown as NonNullable<SessionPayload['accessProfile']>;

beforeEach(() => {
  findMany.mockReset();
  findMany.mockResolvedValue(ROWS);
});

describe('listContactOrgOptions', () => {
  it('без компании в сессии — пустой список, база не опрашивается', async () => {
    expect(
      await listContactOrgOptions(prisma, session({ role: 'admin', companyId: null }), true)
    ).toEqual([]);
    const noCompany = { sub: 'u1', role: 'manager' } as SessionPayload;
    expect(await listContactOrgOptions(prisma, noCompany, false)).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('администратор — пол компании, имя по алфавиту, не больше 500', async () => {
    const r = await listContactOrgOptions(prisma, session({ role: 'admin' }), false);
    expect(r).toEqual(ROWS);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { companyId: 'c1' },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 500,
    });
  });

  it('руководитель без профиля — пол компании независимо от teamMode', async () => {
    await listContactOrgOptions(prisma, session({ role: 'leader' }), false);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
    await listContactOrgOptions(prisma, session({ role: 'leader' }), true);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' } })
    );
  });

  it('руководитель с профилем — как менеджер: пол компании И managerOrgScope', async () => {
    const s = session({ role: 'leader', accessProfile: PROFILE });
    await listContactOrgOptions(prisma, s, true);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [{ companyId: 'c1' }, managerOrgScope(s, true)] },
      })
    );
  });

  it('менеджер — пол компании И managerOrgScope с тем же teamMode', async () => {
    const s = session({ role: 'manager' });
    await listContactOrgOptions(prisma, s, false);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [{ companyId: 'c1' }, managerOrgScope(s, false)] },
      })
    );
    // Скоуп закреплений — не пустая заглушка: в нём видны закреплённые организации.
    expect(managerOrgScope(s, false)).toEqual({ id: { in: ['o1'] } });

    await listContactOrgOptions(prisma, s, true);
    expect(findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { AND: [{ companyId: 'c1' }, managerOrgScope(s, true)] },
      })
    );
    expect(managerOrgScope(s, true)).toEqual({ companyId: 'c1' });
  });
});
