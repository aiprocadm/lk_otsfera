import { describe, it, expect, vi } from 'vitest';
import { listUsers, getUser, createUser, updateUser, deactivateUser, reactivateUser } from '@/lib/services/admin/users';

describe('listUsers', () => {
  it('фильтрует по role и active', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { role: 'partner', active: true });

    const findManyArgs = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(findManyArgs.where).toMatchObject({ role: 'partner', isActive: true });
  });

  it('собирает OR-clause для q-поиска по email и name', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { q: 'foo' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual(
      expect.arrayContaining([
        { email: { contains: 'foo', mode: 'insensitive' } },
        { name: { contains: 'foo', mode: 'insensitive' } }
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
            managedOrganizations: []
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, {});
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
              { organization: { name: 'Org B' } }
            ],
            managedOrganizations: []
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, {});
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
            managedOrganizations: [{ organization: { name: 'ManagedOrg' } }]
          }
        ]),
        count: vi.fn().mockResolvedValue(1)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    const { rows } = await listUsers(prisma, {});
    expect(rows[0].attachmentLabel).toBe('ManagedOrg');
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
      managedOrganizations: []
    });

    for (const role of ['admin', 'student'] as const) {
      const prisma = {
        user: {
          findMany: vi.fn().mockResolvedValue([makeUser(role)]),
          count: vi.fn().mockResolvedValue(1)
        }
      } as unknown as Parameters<typeof listUsers>[0];

      const { rows } = await listUsers(prisma, {});
      expect(rows[0].attachmentLabel).toBe('—');
    }
  });

  it('ограничивает take значением 100', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { take: 999 });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.take).toBe(100);
  });

  it('возвращает total из count', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(42)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    const { total } = await listUsers(prisma, {});
    expect(total).toBe(42);
  });

  it('только q → where.OR содержит email и name клаузы, AND отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { q: 'bar' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { email: { contains: 'bar', mode: 'insensitive' } },
      { name: { contains: 'bar', mode: 'insensitive' } }
    ]);
    expect(args.where.AND).toBeUndefined();
  });

  it('q + organizationId → where.AND с двумя вложенными OR, where.OR отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { q: 'baz', organizationId: 'org-1' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toBeUndefined();
    expect(args.where.AND).toEqual([
      {
        OR: [
          { email: { contains: 'baz', mode: 'insensitive' } },
          { name: { contains: 'baz', mode: 'insensitive' } }
        ]
      },
      {
        OR: [
          { organizationUsers: { some: { organizationId: 'org-1' } } },
          { managedOrganizations: { some: { organizationId: 'org-1' } } }
        ]
      }
    ]);
  });

  it('только organizationId → where.OR содержит orgUser и managedOrg клаузы, AND отсутствует', async () => {
    const prisma = {
      user: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0)
      }
    } as unknown as Parameters<typeof listUsers>[0];

    await listUsers(prisma, { organizationId: 'org-2' });

    const args = (prisma.user.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { organizationUsers: { some: { organizationId: 'org-2' } } },
      { managedOrganizations: { some: { organizationId: 'org-2' } } }
    ]);
    expect(args.where.AND).toBeUndefined();
  });
});

describe('getUser', () => {
  it('возвращает null если пользователь не найден', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) }
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, 'nonexistent');
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
              isActive: true
            }
          ],
          managedOrganizations: []
        })
      }
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, 'u1');
    expect(result).not.toBeNull();
    expect(result!.organizationMemberships).toEqual([
      {
        organizationUserId: 'ou1',
        organizationId: 'org1',
        organizationName: 'Org A',
        roleInOrg: 'member',
        isActive: true
      }
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
              isActive: true
            }
          ]
        })
      }
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, 'u2');
    expect(result).not.toBeNull();
    expect(result!.organizationManagerships).toEqual([
      {
        organizationManagerId: 'om1',
        organizationId: 'org2',
        organizationName: 'Org B',
        isActive: true
      }
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
              isActive: true
            }
          ],
          managedOrganizations: []
        })
      }
    } as unknown as Parameters<typeof getUser>[0];

    const result = await getUser(prisma, 'u3');
    expect(result!.organizationMemberships[0].roleInOrg).toBe('');
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
    expect(
      await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'partner' })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('бросает duplicate_email при существующем email', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'existing' }) }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
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
        create: vi.fn().mockResolvedValue(created)
      },
      partnerUser: { create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof createUser>[0];

    const result = await createUser(prisma, 'actor', { email: 'a@x', name: 'A', role: 'organization' });
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
        create: vi.fn().mockResolvedValue(created)
      },
      partnerUser: { create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof createUser>[0];

    await createUser(prisma, 'actor', { email: 'p@x', name: 'P', role: 'partner', partnerId: 'partner1' });
    expect(txMock.partnerUser.create).toHaveBeenCalledWith({
      data: {
        userId: 'u2',
        partnerId: 'partner1',
        roleInPartner: 'member',
        assignedOrgIds: []
      }
    });
  });

  it('не создаёт partnerUser для role=organization', async () => {
    const created = { id: 'u3', email: 'o@x', name: 'O', role: 'organization' as const };
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(created)
      },
      partnerUser: { create: vi.fn() },
      passwordResetToken: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof createUser>[0];

    await createUser(prisma, 'actor', { email: 'o@x', name: 'O', role: 'organization' });
    expect(txMock.partnerUser.create).not.toHaveBeenCalled();
  });
});

describe('updateUser', () => {
  it('бросает self_action_forbidden при изменении своей роли', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(
      await updateUser(prisma, 'me', 'me', { role: 'organization' })
    ).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('бросает admin_role_via_ui при попытке role=admin', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(
      await updateUser(prisma, 'a', 'b', { role: 'admin' as never })
    ).toEqual({ ok: false, error: 'admin_role_via_ui' });
  });

  it('бросает last_admin_protected при попытке deactivate последнего active admin', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1', role: 'admin', isActive: true, partnerId: null, name: 'X'
        }),
        count: vi.fn().mockResolvedValue(0)
      }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof updateUser>[0];

    expect(
      await updateUser(prisma, 'actor', 'u1', { isActive: false })
    ).toEqual({ ok: false, error: 'last_admin_protected' });
  });

  it('бросает role_transition_forbidden для запрещённого перехода (e.g. organization → partner)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'u1', role: 'organization', isActive: true, partnerId: null, name: 'X'
        })
      }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof updateUser>[0];

    expect(
      await updateUser(prisma, 'actor', 'u1', { role: 'partner', partnerId: 'p1' })
    ).toEqual({ ok: false, error: 'role_transition_forbidden' });
  });

  it('бросает self_action_forbidden при попытке деактивировать себя через isActive=false', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof updateUser>[0];
    expect(
      await updateUser(prisma, 'me', 'me', { isActive: false })
    ).toEqual({ ok: false, error: 'self_action_forbidden' });
  });

  it('partner → student: удаляет partnerUser, обновляет user, пишет user_role_changed, возвращает UserDetail', async () => {
    const before = { id: 'u1', role: 'partner' as const, isActive: true, partnerId: 'p1', name: 'X' };
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
      managedOrganizations: []
    };
    const txMock = {
      user: {
        findUnique: vi.fn()
          .mockResolvedValueOnce(before)    // before snapshot
          .mockResolvedValueOnce(userDetail), // getUser re-fetch
        update: vi.fn().mockResolvedValue(updated),
        count: vi.fn()
      },
      partnerUser: { deleteMany: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof updateUser>[0];

    const result = await updateUser(prisma, 'actor', 'u1', { role: 'student' });
    if (!result.ok) throw new Error('expected ok');

    expect(txMock.partnerUser.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(txMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: expect.objectContaining({ role: 'student' }) })
    );
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'user_role_changed' })
      })
    );
    expect(result.user).toMatchObject({ id: 'u1', role: 'student' });
  });
});

describe('deactivateUser', () => {
  it('бросает self_action_forbidden когда actorUserId === id', async () => {
    const prisma = { $transaction: vi.fn() } as unknown as Parameters<typeof deactivateUser>[0];
    expect(await deactivateUser(prisma, 'me', 'me')).toEqual({ ok: false, error: 'self_action_forbidden' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('бросает not_found когда пользователь не существует', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('no-op когда пользователь уже неактивен (нет update, нет audit)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'partner', isActive: false }),
        update: vi.fn(),
        count: vi.fn()
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof deactivateUser>[0];

    await deactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('бросает last_admin_protected при деактивации последнего активного admin', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'admin', isActive: true }),
        count: vi.fn().mockResolvedValue(0)
      }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof deactivateUser>[0];

    expect(await deactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: false, error: 'last_admin_protected' });
  });

  it('деактивирует активного non-admin: update с isActive=false, audit user_deactivated', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role: 'partner', isActive: true }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn()
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof deactivateUser>[0];

    await deactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: false } });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user_deactivated' }) })
    );
  });
});

describe('reactivateUser', () => {
  it('бросает not_found когда пользователь не существует', async () => {
    const txMock = {
      user: { findUnique: vi.fn().mockResolvedValue(null) }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof reactivateUser>[0];

    expect(await reactivateUser(prisma, 'actor', 'u1')).toEqual({ ok: false, error: 'not_found' });
  });

  it('no-op когда пользователь уже активен (нет update, нет audit)', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: true }),
        update: vi.fn()
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).not.toHaveBeenCalled();
    expect(txMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('реактивирует неактивного пользователя: update с isActive=true, audit user_reactivated', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
        update: vi.fn().mockResolvedValue({})
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { isActive: true } });
    expect(txMock.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user_reactivated' }) })
    );
  });

  it('не вызывает assertNotLastActiveAdmin даже для admin-роли', async () => {
    const txMock = {
      user: {
        findUnique: vi.fn().mockResolvedValue({ isActive: false }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn()
      },
      auditLog: { create: vi.fn() }
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock))
    } as unknown as Parameters<typeof reactivateUser>[0];

    await reactivateUser(prisma, 'actor', 'u1');
    expect(txMock.user.count).not.toHaveBeenCalled();
  });
});
