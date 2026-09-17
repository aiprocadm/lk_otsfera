import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getOrgYourManager } from '@/lib/services/organization/yourManager';
import { getPartnerYourManager } from '@/lib/services/partner/yourManager';

/** «Ваш менеджер» (`У-240`, `Р-Э6-6`): первый активный по дате назначения; партнёр — свой, иначе первой организации. */

function db(over: {
  managers?: unknown[];
  partner?: unknown;
  org?: unknown;
}): PrismaClient & { calls: { managerWhere?: unknown } } {
  const calls: { managerWhere?: unknown } = {};
  return {
    calls,
    organizationManager: {
      findMany: vi.fn(async (args: { where: unknown }) => {
        calls.managerWhere = args.where;
        return over.managers ?? [];
      }),
    },
    partner: { findUnique: vi.fn(async () => over.partner ?? null) },
    organization: { findFirst: vi.fn(async () => over.org ?? null) },
  } as unknown as PrismaClient & { calls: { managerWhere?: unknown } };
}

describe('getOrgYourManager', () => {
  it('первый активный менеджер — имя и e-mail; остальные — только числом', async () => {
    const prisma = db({
      managers: [
        { user: { name: 'Анна', email: 'a@uc.ru' } },
        { user: { name: 'Борис', email: 'b@uc.ru' } },
        { user: { name: 'Вера', email: 'v@uc.ru' } },
      ],
    });
    expect(await getOrgYourManager(prisma, 'org1')).toEqual({
      manager: { name: 'Анна', email: 'a@uc.ru' },
      othersCount: 2,
    });
    // Только активные назначения у активных сотрудников контура ЦО.
    expect(prisma.calls.managerWhere).toEqual({
      organizationId: 'org1',
      isActive: true,
      user: { isActive: true, role: { in: ['manager', 'leader'] } },
    });
  });

  it('менеджера нет — null, без «и ещё»', async () => {
    expect(await getOrgYourManager(db({}), 'org1')).toEqual({ manager: null, othersCount: 0 });
  });
});

describe('getPartnerYourManager', () => {
  it('назначенный активный менеджер партнёра — он', async () => {
    const prisma = db({
      partner: { manager: { name: 'Глеб', email: 'g@uc.ru', isActive: true, role: 'leader' } },
      managers: [{ user: { name: 'Анна', email: 'a@uc.ru' } }],
    });
    expect(await getPartnerYourManager(prisma, 'p1')).toEqual({
      manager: { name: 'Глеб', email: 'g@uc.ru' },
      othersCount: 0,
    });
    expect(prisma.organizationManager.findMany).not.toHaveBeenCalled();
  });

  it('менеджер партнёра уволен или не сотрудник ЦО — берём менеджера первой организации', async () => {
    for (const manager of [
      { name: 'Уволен', email: 'x@uc.ru', isActive: false, role: 'manager' },
      { name: 'Админ', email: 'adm@uc.ru', isActive: true, role: 'admin' },
    ]) {
      const prisma = db({
        partner: { manager },
        org: { id: 'org-first' },
        managers: [{ user: { name: 'Анна', email: 'a@uc.ru' } }],
      });
      expect(await getPartnerYourManager(prisma, 'p1')).toEqual({
        manager: { name: 'Анна', email: 'a@uc.ru' },
        othersCount: 0,
      });
      expect(prisma.calls.managerWhere).toMatchObject({ organizationId: 'org-first' });
    }
  });

  it('нет менеджера и нет организаций — null', async () => {
    expect(await getPartnerYourManager(db({ partner: { manager: null } }), 'p1')).toEqual({
      manager: null,
      othersCount: 0,
    });
  });
});
