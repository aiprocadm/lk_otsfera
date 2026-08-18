import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';

const { recordPiiAccess } = vi.hoisted(() => ({ recordPiiAccess: vi.fn() }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess }));

import {
  listUsers,
  listActiveManagerOptions,
  listManagerCandidates,
  getUser,
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  adminRegenerateBackupCodes,
} from '@/lib/services/admin/users';
import { MAX_PARTNER_USERS } from '@/lib/config/teamLimits';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

const ADMIN_SESSION = { sub: 'adm', role: 'admin' as const };

describe('listUsers', () => {
  it('фильтрует по role и active', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { role: 'partner', active: true });

    const findManyArgs = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(findManyArgs.where).toMatchObject({ role: 'partner', isActive: true });
  });

  it('собирает OR-clause для q-поиска по email и name', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { q: 'foo' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { email: { contains: 'foo', mode: 'insensitive' } },
        { name: { contains: 'foo', mode: 'insensitive' } },
      ])
    );
  });

  it('возвращает attachmentLabel для partner', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u1',
            email: 'p@x',
            name: 'P',
            role: 'partner',
            isActive: true,
            createdAt: new Date(),
            partner: { name: 'Acme' },
            organizationUsers: [],
            managedOrganizations: [],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('Acme');
  });

  it('возвращает attachmentLabel для organization с несколькими членствами', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u2',
            email: 'o@x',
            name: 'O',
            role: 'organization',
            isActive: true,
            createdAt: new Date(),
            partner: null,
            organizationUsers: [
              { organization: { name: 'Org A' } },
              { organization: { name: 'Org B' } },
            ],
            managedOrganizations: [],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('Org A (+1)');
  });

  it('возвращает attachmentLabel для manager', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u3',
            email: 'm@x',
            name: 'M',
            role: 'manager',
            isActive: true,
            createdAt: new Date(),
            partner: null,
            organizationUsers: [],
            managedOrganizations: [{ organization: { name: 'ManagedOrg' } }],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('ManagedOrg');
  });

  it('роль leader получает менеджерский attachmentLabel (ТЗ 2026-08-17)', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'u3l',
            email: 'l@x',
            name: 'L',
            role: 'leader',
            isActive: true,
            createdAt: new Date(),
            partner: null,
            organizationUsers: [],
            managedOrganizations: [{ organization: { name: 'LeaderOrg' } }],
          },
        ]),
        count: vi.fn().mockResolvedValue(1),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows[0].attachmentLabel).toBe('LeaderOrg');
  });

  it('возвращает "—" для admin и student ролей', async () => {
    const makeUser = (role: 'admin' | 'student') => ({
      id: 'u4',
      email: 'a@x',
      name: 'A',
      role,
      isActive: true,
      createdAt: new Date(),
      partner: null,
      organizationUsers: [],
      managedOrganizations: [],
    });

    for (const role of ['admin', 'student'] as const) {
      const prisma = {
        user: {
          findMany: vi.fn().mockResolvedValue([makeUser(role)]),
          count: vi.fn().mockResolvedValue(1),
        },
      } as unknown as Parameters<typeof listUsers>[0];

      const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
      expect(rows[0].attachmentLabel).toBe('—');
    }
  });

  it('ограничивает take значением 100', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { take: 999 });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it('возвращает total из count', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(42),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { total } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(total).toBe(42);
  });

  it('только q → where.OR содержит email и name клаузы, AND отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { q: 'bar' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { email: { contains: 'bar', mode: 'insensitive' } },
      { name: { contains: 'bar', mode: 'insensitive' } },
    ]);
    expect(args.where.AND).toBeUndefined();
  });

  it('q + organizationId → where.AND с двумя вложенными OR, where.OR отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { q: 'baz', organizationId: 'org-1' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
    expect(args.where.AND).toEqual([
      {
        OR: [
          { email: { contains: 'baz', mode: 'insensitive' } },
          { name: { contains: 'baz', mode: 'insensitive' } },
        ],
      },
      {
        OR: [
          { organizationUsers: { some: { organizationId: 'org-1' } } },
          { managedOrganizations: { some: { organizationId: 'org-1' } } },
        ],
      },
    ]);
  });

  it('только organizationId → where.OR содержит orgUser и managedOrg клаузы, AND отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, { organizationId: 'org-2' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { organizationUsers: { some: { organizationId: 'org-2' } } },
      { managedOrganizations: { some: { organizationId: 'org-2' } } },
    ]);
    expect(args.where.AND).toBeUndefined();
  });

  it('invitePending: true при passwordHash=null, false при установленном пароле (ФТ-10.2)', async () => {
    const base = {
      email: 'x@x',
      name: 'X',
      role: 'organization' as const,
      isActive: true,
      createdAt: new Date(),
      partner: null,
      organizationUsers: [],
      managedOrganizations: [],
    };
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([
          { ...base, id: 'u-pending', passwordHash: null },
          { ...base, id: 'u-active', passwordHash: 'bcrypt-hash' },
        ]),
        count: vi.fn().mockResolvedValue(2),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, ADMIN_SESSION, {});
    expect(rows.find((r) => r.id === 'u-pending')?.invitePending).toBe(true);
    expect(rows.find((r) => r.id === 'u-active')?.invitePending).toBe(false);
  });

  it('listUsers журналирует состав выдачи', async () => {
    recordPiiAccess.mockClear();
    const row = (id: string) => ({
      id,
      email: `${id}@x`,
      name: id,
      role: 'admin',
      isActive: true,
      createdAt: new Date(),
      partner: null,
      organizationUsers: [],
      managedOrganizations: [],
    });
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([row('U1'), row('U2')]),
        count: vi.fn().mockResolvedValue(2),
      },
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, ADMIN_SESSION, {});
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        context: 'admin_users_list',
        subjectIds: ['U1', 'U2'],
      })
    );
  });
});

describe('getUser', () => {
  it('возвращает null если пользователь не найден', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, ADMIN_SESSION, 'nonexistent');
    expect(result).toBeNull();
  });

  it('маппит organizationUsers в organizationMemberships', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          email: 'o@x',
          name: 'O',
          role: 'organization',
          isActive: true,
          createdAt: new Date(),
          partnerId: null,
          partner: null,
          organizationUsers: [
            {
              id: 'ou1',
              organizationId: 'org1',
              organization: { id: 'org1', name: 'Org A' },
              roleInOrg: 'member',
              isActive: true,
            },
          ],
          managedOrganizations: [],
        }),
      },
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, ADMIN_SESSION, 'u1');
    expect(result).not.toBeNull();
    expect(result!.organizationMemberships).toEqual([
      {
        organizationUserId: 'ou1',
        organizationId: 'org1',
        organizationName: 'Org A',
        roleInOrg: 'member',
        isActive: true,
      },
    ]);
    expect(result!.organizationManagerships).toEqual([]);
  });

  it('маппит managedOrganizations в organizationManagerships', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u2',
          email: 'm@x',
          name: 'M',
          role: 'manager',
          isActive: true,
          createdAt: new Date(),
          partnerId: null,
          partner: null,
          organizationUsers: [],
          managedOrganizations: [
            {
              id: 'om1',
              organizationId: 'org2',
              organization: { id: 'org2', name: 'Org B' },
              isActive: true,
            },
          ],
        }),
      },
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, ADMIN_SESSION, 'u2');
    expect(result).not.toBeNull();
    expect(result!.organizationManagerships).toEqual([
      {
        organizationManagerId: 'om1',
        organizationId: 'org2',
        organizationName: 'Org B',
        isActive: true,
      },
    ]);
    expect(result!.organizationMemberships).toEqual([]);
  });

  it('roleInOrg null → пустая строка в маппинге', async () => {
    const prisma = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u3',
          email: 'o2@x',
          name: 'O2',
          role: 'organization',
          isActive: true,
          createdAt: new Date(),
          partnerId: null,
          partner: null,
          organizationUsers: [
            {
              id: 'ou2',
              organizationId: 'org3',
              organization: { id: 'org3', name: 'Org C' },
              roleInOrg: null,
              isActive: true,
            },
          ],
          managedOrganizations: [],
        }),
      },
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, ADMIN_SESSION, 'u3');
    expect(result!.organizationMemberships[0].roleInOrg).toBe('');
  });

  it('карточка UserDetail несёт invitePending по passwordHash (ФТ-10.2)', async () => {
    const detail = (passwordHash: string | null) => ({
      id: 'u-d',
      email: 'd@x',
      name: 'D',
      role: 'organization',
      isActive: true,
      createdAt: new Date(),
      passwordHash,
      partnerId: null,
      partner: null,
      organizationUsers: [],
      managedOrganizations: [],
    });

    const prismaPending = {
      user: { findUnique: vi.fn().mockResolvedValue(detail(null)) },
    } as unknown as Parameters<typeof getUser>[0];
    expect((await getUser(prismaPending, ADMIN_SESSION, 'u-d'))!.invitePending).toBe(true);

    const prismaActive = {
      user: { findUnique: vi.fn().mockResolvedValue(detail('bcrypt-hash')) },
    } as unknown as Parameters<typeof getUser>[0];
    expect((await getUser(prismaActive, ADMIN_SESSION, 'u-d'))!.invitePending).toBe(false);
  });

  it('getUser журналирует карточку; null-ветка — нет', async () => {
    recordPiiAccess.mockClear();
    const prismaWithUser = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'U1',
          email: 'u@x',
          name: 'U',
          role: 'organization',
          isActive: true,
          createdAt: new Date(),
          partnerId: null,
          partner: null,
          organizationUsers: [],
          managedOrganizations: [],
        }),
      },
    } as unknown as Parameters<typeof getUser>[0];

    await getUser(prismaWithUser, ADMIN_SESSION, 'U1');
    expect(recordPiiAccess).toHaveBeenCalledWith(
      prismaWithUser,
      expect.objectContaining({
        context: 'admin_user_view',
        subjectIds: ['U1'],
      })
    );

    recordPiiAccess.mockClear();
    const prismaWithoutUser = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Parameters<typeof getUser>[0];
    await getUser(prismaWithoutUser, ADMIN_SESSION, 'nope');
    expect(recordPiiAccess).not.toHaveBeenCalled();
  });
});

describe('createUser', () => {
  it('бросает admin_role_via_ui при попытке role=admin', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof createUser>[0];
    expect(
      await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'admin' as never })
    ).toEqual({ ok: false, error: 'admin_role_via_ui' });
  });

  it('бросает not_found если role=partner без partnerId', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof createUser>[0];
    expect(await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'partner' })).toEqual(
      { ok: false, error: 'not_found' }
    );
  });

  it('бросает duplicate_email при существующем email', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof createUser>[0];

    expect(
      await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'organization' })
    ).toEqual({ ok: false, error: 'duplicate_email' });
  });

  it('создаёт user + invite token, пишет audit', async () => {
    const created = { id: 'u1', email: 'a@x', name: 'A', role: 'organization' as const };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      partnerUser: { create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof createUser>[0];

    const result = await createUser(prisma, 'actor', {
      email: 'a@x',
      name: 'A',
      role: 'organization',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.user).toMatchObject(created);
    expect(result.inviteToken).toBeTruthy();
    expect(txMock.auditLog.create).toHaveBeenCalled();
  });

  it('создаёт partnerUser для role=partner с partnerId', async () => {
    const created = { id: 'u2', email: 'p@x', name: 'P', role: 'partner' as const };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      partnerUser: { count: vi.fn().mockResolvedValue(0), create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof createUser>[0];

    await createUser(prisma, 'actor', {
      email: 'p@x',
      name: 'P',
      role: 'partner',
      partnerId: 'partner1',
    });
    expect(txMock.partnerUser.create).toHaveBeenCalledWith({
      data: {
        userId: 'u2',
        partnerId: 'partner1',
        roleInPartner: 'member',
        assignedOrgIds: [],
      },
    });
  });

  it('отклоняет создание partner-пользователя при достижении лимита (§14)', async () => {
    const created = { id: 'u9', email: 'p9@x', name: 'P9', role: 'partner' as const };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      partnerUser: { count: vi.fn().mockResolvedValue(MAX_PARTNER_USERS), create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof createUser>[0];

    const result = await createUser(prisma, 'actor', {
      email: 'p9@x',
      name: 'P9',
      role: 'partner',
      partnerId: 'partner1',
    });
    expect(result).toEqual({ ok: false, error: 'member_limit_reached' });
    expect(txMock.partnerUser.create).not.toHaveBeenCalled();
  });

  it('не создаёт partnerUser для role=organization', async () => {
    const created = { id: 'u3', email: 'o@x', name: 'O', role: 'organization' as const };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created),
      },
      partnerUser: { create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof createUser>[0];

    await createUser(prisma, 'actor', { email: 'o@x', name: 'O', role: 'organization' });
    expect(txMock.partnerUser.create).not.toHaveBeenCalled();
  });
});

describe('updateUser', () => {
  it('бросает self_action_forbidden при изменении своей роли', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(await updateUser(prisma, 'me', 'me', { role: 'organization' })).toEqual({
      ok: false,
      error: 'self_action_forbidden',
    });
  });

  it('бросает admin_role_via_ui при попытке role=admin', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(await updateUser(prisma, 'a', 'b', { role: 'admin' as never })).toEqual({
      ok: false,
      error: 'admin_role_via_ui',
    });
  });

  it('бросает last_admin_protected при попытке deactivate последнего active admin', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          role: 'admin',
          isActive: true,
          partnerId: null,
          name: 'X',
        }),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof updateUser>[0];

    expect(await updateUser(prisma, 'actor', 'u1', { isActive: false })).toEqual({
      ok: false,
      error: 'last_admin_protected',
    });
  });

  it('бросает role_transition_forbidden для запрещённого перехода (e.g. organization → partner)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1',
          role: 'organization',
          isActive: true,
          partnerId: null,
          name: 'X',
        }),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof updateUser>[0];

    expect(await updateUser(prisma, 'actor', 'u1', { role: 'partner', partnerId: 'p1' })).toEqual({
      ok: false,
      error: 'role_transition_forbidden',
    });
  });

  it('бросает self_action_forbidden при попытке деактивировать себя через isActive=false', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(await updateUser(prisma, 'me', 'me', { isActive: false })).toEqual({
      ok: false,
      error: 'self_action_forbidden',
    });
  });

  it('partner → student: удаляет partnerUser, обновляет user, пишет user_role_changed, возвращает UserDetail', async () => {
    const before = {
      id: 'u1',
      role: 'partner' as const,
      isActive: true,
      partnerId: 'p1',
      name: 'X',
    };
    const updated = { role: 'student' as const, isActive: true, partnerId: null, name: 'X' };
    const userDetail = {
      id: 'u1',
      email: 'x@x',
      name: 'X',
      role: 'student' as const,
      isActive: true,
      createdAt: new Date(),
      partnerId: null,
      partner: null,
      organizationUsers: [],
      managedOrganizations: [],
    };
    const txMock = {
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValueOnce(before) // before snapshot
          .mockResolvedValueOnce(userDetail), // getUser re-fetch
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn(),
      },
      partnerUser: { deleteMany: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof updateUser>[0];

    const result = await updateUser(prisma, 'actor', 'u1', { role: 'student' });
    if (!result.ok) throw new Error('expected ok');

    expect(txMock.partnerUser.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(txMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ role: 'student' }),
      })
    );
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'user_role_changed' }),
      })
    );
    expect(result.user).toMatchObject({ id: 'u1', role: 'student' });
  });
});

describe('deactivateUser', () => {
  it('бросает self_action_forbidden когда actorUserId === id', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof deactivateUser>[0];
    expect(await deactivateUser(prisma, 'me', 'me')).toEqual({
      ok: false,
      error: 'self_action_forbidden',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('бросает not_found когда пользователь не существует', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('no-op когда пользователь уже неактивен (нет update, нет audit)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'partner', isActive: false }),
        update: vi.fn(),
        count: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    await deactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('бросает last_admin_protected при деактивации последнего активного admin', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', isActive: true }),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({
      ok: false,
      error: 'last_admin_protected',
    });
  });

  it('деактивирует активного non-admin: update с isActive=false, audit user_deactivated', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'partner', isActive: true }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    await deactivateUser(prisma, 'actor', 'u1');
    // ФТ-11.2: вместе с флагом гасим и живые сессии — иначе деактивированный
    // работает до истечения 7-дневного токена.
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user_deactivated' }) })
    );
  });

  it('ФТ-11.2: деактивация admin (при наличии второго админа) тоже инкрементит sessionVersion', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', isActive: true }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1), // есть ещё один активный админ
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: true });
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: false, sessionVersion: { increment: 1 } },
    });
  });

  it('ФТ-11.2: повторная деактивация уже неактивного не инкрементит sessionVersion', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'partner', isActive: false }),
        update: vi.fn(),
        count: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: true });
    expect(txMock.user.update).not.toHaveBeenCalled();
  });

  it('ФТ-11.2: last_admin_protected не доходит до инкремента', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', isActive: true }),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({
      ok: false,
      error: 'last_admin_protected',
    });
    expect(txMock.user.update).not.toHaveBeenCalled();
  });
});

describe('reactivateUser', () => {
  it('бросает not_found когда пользователь не существует', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof reactivateUser>[0];

    expect(await reactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('no-op когда пользователь уже активен (нет update, нет audit)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true }),
        update: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('реактивирует неактивного пользователя: update с isActive=true, audit user_reactivated', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isActive: true },
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user_reactivated' }) })
    );
  });

  it('не вызывает assertNotLastActiveAdmin даже для admin-роли', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn(),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.count).not.toHaveBeenCalled();
  });

  it('ФТ-11.2: реактивация НЕ трогает sessionVersion (нечего отзывать)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock)),
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    const data = txMock.user.update.mock.calls[0][0].data;
    expect(data).toEqual({ isActive: true });
    expect(data).not.toHaveProperty('sessionVersion');
  });
});

describe('adminRegenerateBackupCodes', () => {
  function makePrisma(target: { id: string; role: string } | null) {
    const bcDeleteMany = vi.fn().mockResolvedValue(undefined);
    const bcCreateMany = vi.fn().mockResolvedValue(undefined);
    const auditCreate = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(target) },
      auditLog: { create: auditCreate },
      // generateBackupCodes выполняет транзакцию с deleteMany+createMany
      $transaction: vi
        .fn()
        .mockImplementation((cb: (tx: unknown) => unknown) =>
          cb({ twoFactorBackupCode: { deleteMany: bcDeleteMany, createMany: bcCreateMany } })
        ),
    } as unknown as Parameters<typeof adminRegenerateBackupCodes>[0];
    return { prisma, bcDeleteMany, bcCreateMany, auditCreate };
  }

  it('manager target: 10 fresh hashed codes + audit with target entityId', async () => {
    const { prisma, bcDeleteMany, bcCreateMany, auditCreate } = makePrisma({
      id: 'm1',
      role: 'manager',
    });
    const res = await adminRegenerateBackupCodes(prisma, 'admin1', 'm1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.codes).toHaveLength(10);
      const rows = (bcCreateMany.mock.calls[0][0] as { data: { codeHash: string }[] }).data;
      expect(rows.map((r) => r.codeHash)).toEqual(res.codes.map(sha256));
    }
    expect(bcDeleteMany).toHaveBeenCalledWith({ where: { userId: 'm1' } });
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: '2fa_backup_regenerated',
          entity: 'auth_2fa',
          entityId: 'm1',
          userId: 'admin1',
        }),
      })
    );
  });

  it('admin target: allowed', async () => {
    const { prisma } = makePrisma({ id: 'a2', role: 'admin' });
    expect((await adminRegenerateBackupCodes(prisma, 'admin1', 'a2')).ok).toBe(true);
  });

  it('leader target: allowed — руководитель тоже staff (ТЗ 2026-08-17)', async () => {
    const { prisma } = makePrisma({ id: 'ldr1', role: 'leader' });
    expect((await adminRegenerateBackupCodes(prisma, 'admin1', 'ldr1')).ok).toBe(true);
  });

  it('missing target → not_found', async () => {
    const { prisma, bcCreateMany } = makePrisma(null);
    expect(await adminRegenerateBackupCodes(prisma, 'admin1', 'ghost')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(bcCreateMany).not.toHaveBeenCalled();
  });

  it('non-staff target → not_staff, no codes issued', async () => {
    const { prisma, bcCreateMany } = makePrisma({ id: 'p1', role: 'partner' });
    expect(await adminRegenerateBackupCodes(prisma, 'admin1', 'p1')).toEqual({
      ok: false,
      error: 'not_staff',
    });
    expect(bcCreateMany).not.toHaveBeenCalled();
  });

  it('rethrows a non-AdminUserError (e.g. a DB failure) instead of swallowing it', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as Parameters<typeof adminRegenerateBackupCodes>[0];
    await expect(adminRegenerateBackupCodes(prisma, 'admin1', 'm1')).rejects.toThrow('db down');
  });
});

/**
 * Аудит A1: справочники менеджеров уехали со страниц /admin/intake и
 * /admin/orders/[id] в сервис — здесь пиннится форма их запросов.
 */
describe('listActiveManagerOptions', () => {
  it('берёт активных менеджеров по алфавиту, не более 200, только id+name', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'm1', name: 'Мария' }]);
    const prisma = { user: { findMany } } as unknown as Parameters<
      typeof listActiveManagerOptions
    >[0];

    const rows = await listActiveManagerOptions(prisma);

    expect(findMany).toHaveBeenCalledWith({
      // Контур обеих моделей (ТЗ 2026-08-17): руководитель тоже кандидат.
      where: { role: { in: ['manager', 'leader'] }, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    expect(rows).toEqual([{ id: 'm1', name: 'Мария' }]);
  });
});

describe('listManagerCandidates', () => {
  it('берёт всех активных менеджеров (без ограничения по организации) по e-mail', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'm1', name: 'Мария', email: 'm@x.com' }]);
    const prisma = { user: { findMany } } as unknown as Parameters<typeof listManagerCandidates>[0];

    const rows = await listManagerCandidates(prisma);

    expect(findMany).toHaveBeenCalledWith({
      where: { role: { in: ['manager', 'leader'] }, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { email: 'asc' },
    });
    expect(rows).toEqual([{ id: 'm1', name: 'Мария', email: 'm@x.com' }]);
  });
});
