import { describe, it, expect, vi } from 'vitest';
import { listUsers } from '@/lib/services/admin/users';

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
