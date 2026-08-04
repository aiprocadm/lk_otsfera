/**
 * Unit tests for src/lib/services/partner/team.ts
 * Covers the ternary branch in roleInPartner mapping.
 */
import { describe, it, expect, vi } from 'vitest';

// Этап 4 (ФТ-10.1): inviteMember больше не выдаёт временный bcrypt-пароль —
// создаёт пользователя без пароля + invite-токен через createInviteToken.
const { createInviteToken } = vi.hoisted(() => ({
  createInviteToken: vi.fn().mockResolvedValue({ token: 'tok-unit', expiresAt: new Date() }),
}));
vi.mock('@/lib/auth/passwordReset', () => ({ createInviteToken }));

import {
  listTeam,
  inviteMember,
  assignOrgs,
  deactivateMember,
  getPartnerName,
} from '@/lib/services/partner/team';
import { MAX_PARTNER_USERS } from '@/lib/config/teamLimits';

describe('listTeam — unit (roleInPartner mapping)', () => {
  it('maps roleInPartner "admin" → "admin"', async () => {
    const prisma = {
      partnerUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pu1',
            userId: 'u1',
            partnerId: 'p1',
            roleInPartner: 'admin',
            assignedOrgIds: [],
            isActive: true,
            createdAt: new Date(),
            user: { email: 'a@a.com', name: 'Admin', passwordHash: 'bcrypt-hash' },
          },
        ]),
      },
    } as any;
    const team = await listTeam(prisma, 'p1');
    expect(team[0].roleInPartner).toBe('admin');
    // Пароль установлен → приглашение уже принято.
    expect(team[0].invitePending).toBe(false);
  });

  it('maps any non-admin roleInPartner → "manager"', async () => {
    const prisma = {
      partnerUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pu2',
            userId: 'u2',
            partnerId: 'p1',
            // "supervisor" is a non-standard value — the ternary maps it to 'manager'
            roleInPartner: 'supervisor',
            assignedOrgIds: [],
            isActive: true,
            createdAt: new Date(),
            user: { email: 'b@b.com', name: 'Bob', passwordHash: null },
          },
        ]),
      },
    } as any;
    const team = await listTeam(prisma, 'p1');
    expect(team[0].roleInPartner).toBe('manager');
    // ФТ-10.2: passwordHash === null → invitePending.
    expect(team[0].invitePending).toBe(true);
  });

  it('maps roleInPartner "manager" → "manager"', async () => {
    const prisma = {
      partnerUser: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'pu3',
            userId: 'u3',
            partnerId: 'p1',
            roleInPartner: 'manager',
            assignedOrgIds: ['org1'],
            isActive: false,
            createdAt: new Date(),
            user: { email: 'c@c.com', name: 'Mgr', passwordHash: 'h' },
          },
        ]),
      },
    } as any;
    const team = await listTeam(prisma, 'p1');
    expect(team[0].roleInPartner).toBe('manager');
    expect(team[0].assignedOrgIds).toEqual(['org1']);
    expect(team[0].isActive).toBe(false);
  });
});

describe('inviteMember — unit', () => {
  it('returns org_out_of_scope when orgs outside partner', async () => {
    const prisma = {
      organization: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn(), create: vi.fn() },
      partnerUser: { create: vi.fn() },
      $transaction: vi.fn(),
    } as any;
    expect(
      await inviteMember(prisma, {
        partnerId: 'p1',
        email: 'x@x.com',
        name: 'X',
        roleInPartner: 'manager',
        assignedOrgIds: ['bad-org'],
      })
    ).toEqual({ ok: false, error: 'org_out_of_scope' });
  });

  it('returns email_taken when user already exists', async () => {
    const prisma = {
      organization: { count: vi.fn().mockResolvedValue(0) },
      partnerUser: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
      $transaction: vi.fn(),
    } as any;
    expect(
      await inviteMember(prisma, {
        partnerId: 'p1',
        email: 'taken@x.com',
        name: 'X',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      })
    ).toEqual({ ok: false, error: 'email_taken' });
  });

  it('returns member_limit_reached when the partner is at the user cap', async () => {
    const prisma = {
      organization: { count: vi.fn() },
      partnerUser: { count: vi.fn().mockResolvedValue(MAX_PARTNER_USERS) },
      user: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    } as any;
    expect(
      await inviteMember(prisma, {
        partnerId: 'p1',
        email: 'over@x.com',
        name: 'Over',
        roleInPartner: 'manager',
        assignedOrgIds: [],
      })
    ).toEqual({ ok: false, error: 'member_limit_reached' });
    // Short-circuits before the email lookup / user creation.
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('successfully creates user and partnerUser via transaction when no conflicts', async () => {
    createInviteToken.mockClear();
    const newUser = { id: 'u-new', email: 'new@x.com', role: 'partner', partnerId: 'p1' };
    const newPartnerUser = {
      id: 'pu-new',
      partnerId: 'p1',
      userId: 'u-new',
      roleInPartner: 'manager',
    };
    const tx = {
      user: { create: vi.fn().mockResolvedValue(newUser) },
      partnerUser: { create: vi.fn().mockResolvedValue(newPartnerUser) },
    };
    const prisma = {
      organization: { count: vi.fn().mockResolvedValue(1) }, // 1 org in scope
      partnerUser: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue(null) }, // no existing user
      $transaction: vi.fn().mockImplementation((cb: (arg: unknown) => unknown) => cb(tx)),
    } as any;
    const result = await inviteMember(prisma, {
      partnerId: 'p1',
      email: 'new@x.com',
      name: 'Новый',
      roleInPartner: 'manager',
      assignedOrgIds: ['org1'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.user).toEqual(newUser);
    expect(result.partnerUser).toEqual(newPartnerUser);
    // Этап 4: пользователь без пароля + invite-токен внутри той же транзакции.
    expect(tx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@x.com', role: 'partner', passwordHash: null }),
      })
    );
    expect(createInviteToken).toHaveBeenCalledWith(tx, 'u-new');
    expect(result.inviteUrl).toContain('/reset-password?token=tok-unit');
  });

  it('succeeds with empty assignedOrgIds (no scope check needed)', async () => {
    const newUser = { id: 'u2', email: 'u2@x.com', role: 'partner', partnerId: 'p1' };
    const tx = {
      user: { create: vi.fn().mockResolvedValue(newUser) },
      partnerUser: { create: vi.fn().mockResolvedValue({ id: 'pu2' }) },
    };
    createInviteToken.mockClear();
    const prisma = {
      organization: { count: vi.fn() },
      partnerUser: { count: vi.fn().mockResolvedValue(0) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn().mockImplementation((cb: (arg: unknown) => unknown) => cb(tx)),
    } as any;
    await inviteMember(prisma, {
      partnerId: 'p1',
      email: 'u2@x.com',
      name: 'U2',
      roleInPartner: 'admin',
      assignedOrgIds: [],
    });
    // No org count check when list is empty
    expect(prisma.organization.count).not.toHaveBeenCalled();
    expect(tx.user.create).toHaveBeenCalled();
    expect(createInviteToken).toHaveBeenCalledWith(tx, 'u2');
  });
});

describe('assignOrgs — unit', () => {
  it('returns org_out_of_scope when orgs outside partner', async () => {
    const prisma = {
      organization: { count: vi.fn().mockResolvedValue(0) },
      partnerUser: { update: vi.fn() },
    } as any;
    expect(
      await assignOrgs(prisma, { partnerId: 'p1', userId: 'u1', assignedOrgIds: ['foreign'] })
    ).toEqual({ ok: false, error: 'org_out_of_scope' });
  });

  it('succeeds when assignedOrgIds is empty (no scope check)', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'pu1', assignedOrgIds: [] });
    const prisma = {
      organization: { count: vi.fn() },
      partnerUser: { update },
    } as any;
    const result = await assignOrgs(prisma, { partnerId: 'p1', userId: 'u1', assignedOrgIds: [] });
    expect(prisma.organization.count).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('expected ok');
    expect(result.partnerUser.assignedOrgIds).toEqual([]);
  });
});

describe('deactivateMember — unit', () => {
  it('returns not_found when partnerUser not found', async () => {
    const userUpdate = vi.fn();
    const prisma = {
      partnerUser: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
      user: { update: userUpdate },
    } as any;
    expect(await deactivateMember(prisma, { partnerId: 'p1', userId: 'u1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    // ФТ-11.2: нечего снимать — сессии не отзываем.
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('skips admin-count check when target is manager (not admin)', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'pu1', isActive: false });
    const userUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'pu1', roleInPartner: 'manager', isActive: true }),
        count: vi.fn(),
        update,
      },
      user: { update: userUpdate },
    } as any;
    const result = await deactivateMember(prisma, { partnerId: 'p1', userId: 'u1' });
    expect(prisma.partnerUser.count).not.toHaveBeenCalled();
    if (!result.ok) throw new Error('expected ok');
    expect(result.partnerUser.isActive).toBe(false);
    // ФТ-11.2: partnerRole/assignedOrgIds живут в токене → отзываем сессии
    // снятого участника (по args.userId).
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it('allows deactivating an inactive admin without admin-count check', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'pu1', isActive: false });
    const userUpdate = vi.fn().mockResolvedValue({});
    const prisma = {
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'pu1', roleInPartner: 'admin', isActive: false }),
        count: vi.fn(),
        update,
      },
      user: { update: userUpdate },
    } as any;
    await deactivateMember(prisma, { partnerId: 'p1', userId: 'u1' });
    // isActive is false → skip count check (admin guard only fires when isActive is true)
    expect(prisma.partnerUser.count).not.toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { sessionVersion: { increment: 1 } },
    });
  });

  it('returns last_admin_protected when trying to deactivate the only active admin', async () => {
    const userUpdate = vi.fn();
    const prisma = {
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'pu1', roleInPartner: 'admin', isActive: true }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
      user: { update: userUpdate },
    } as any;
    expect(await deactivateMember(prisma, { partnerId: 'p1', userId: 'u1' })).toEqual({
      ok: false,
      error: 'last_admin_protected',
    });
    // ФТ-11.2: защита последнего админа отменяет и отзыв сессий.
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('ФТ-11.2: инкремент идёт ПОСЛЕ успешного partnerUser.update, ровно один раз', async () => {
    const order: string[] = [];
    const update = vi.fn().mockImplementation(async () => {
      order.push('partnerUser.update');
      return { id: 'pu2', isActive: false };
    });
    const userUpdate = vi.fn().mockImplementation(async () => {
      order.push('user.update');
      return {};
    });
    const prisma = {
      partnerUser: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'pu2', roleInPartner: 'admin', isActive: true }),
        count: vi.fn().mockResolvedValue(2), // есть второй активный админ
        update,
      },
      user: { update: userUpdate },
    } as any;

    const result = await deactivateMember(prisma, { partnerId: 'p1', userId: 'u-target' });
    expect(result.ok).toBe(true);
    expect(order).toEqual(['partnerUser.update', 'user.update']);
    expect(userUpdate).toHaveBeenCalledOnce();
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: 'u-target' },
      data: { sessionVersion: { increment: 1 } },
    });
  });
});

describe('getPartnerName — unit (аудит A1: запрос уехал из роута приглашения)', () => {
  it('узкий select по id партнёра, возвращает название', async () => {
    const findUnique = vi.fn().mockResolvedValue({ name: 'ООО Партнёр' });
    const prisma = { partner: { findUnique } } as never;

    await expect(getPartnerName(prisma, 'p1')).resolves.toBe('ООО Партнёр');
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'p1' }, select: { name: true } });
  });

  it('записи нет → null (роут подставит обобщённое «партнёр»)', async () => {
    const prisma = { partner: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
    await expect(getPartnerName(prisma, 'p-ghost')).resolves.toBeNull();
  });
});
