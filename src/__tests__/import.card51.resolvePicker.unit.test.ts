import { describe, it, expect, vi } from 'vitest';
import { searchResolveOrgs, listResolveOrders } from '@/lib/services/import/oneCAccountCard/resolve-picker';

const admin = { sub: 'a1', role: 'admin', companyId: 'c1' } as never;
const manager = { sub: 'm1', role: 'manager', companyId: 'c1', managedOrgIds: ['orgA'] } as never;
const managerNoOrgs = { sub: 'm2', role: 'manager', companyId: 'c1', managedOrgIds: [] } as never;
const partner = { sub: 'p1', role: 'partner' } as never;

describe('searchResolveOrgs', () => {
  it('returns [] for non-staff without querying', async () => {
    const prisma = { organization: { findMany: vi.fn() } } as never;
    expect(await searchResolveOrgs(prisma, partner, {})).toEqual([]);
    expect((prisma as { organization: { findMany: ReturnType<typeof vi.fn> } }).organization.findMany).not.toHaveBeenCalled();
  });

  it('admin without query searches all orgs (empty where)', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'o1', name: 'A', inn: '77' }]);
    const prisma = { organization: { findMany } } as never;
    const res = await searchResolveOrgs(prisma, admin, {});
    expect(res).toEqual([{ id: 'o1', name: 'A', inn: '77' }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {}, take: 50 }));
  });

  it('admin with query builds an insensitive OR over name/inn/externalId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { organization: { findMany } } as never;
    await searchResolveOrgs(prisma, admin, { q: '  Ромашка  ', take: 200 });
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([
      { name: { contains: 'Ромашка', mode: 'insensitive' } },
      { inn: { contains: 'Ромашка', mode: 'insensitive' } },
      { externalId: { contains: 'Ромашка', mode: 'insensitive' } },
    ]);
    // take clamped to MAX
    expect(findMany.mock.calls[0][0].take).toBe(50);
  });

  it('scoped manager restricts to managedOrgIds', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { organization: { findMany } } as never;
    await searchResolveOrgs(prisma, manager, { q: 'x' });
    const where = findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ id: { in: ['orgA'] } });
  });

  it('manager with no managed orgs returns [] without querying', async () => {
    const findMany = vi.fn();
    const prisma = { organization: { findMany } } as never;
    expect(await searchResolveOrgs(prisma, managerNoOrgs, {})).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('listResolveOrders', () => {
  it('returns [] for non-staff', async () => {
    const prisma = { order: { findMany: vi.fn() } } as never;
    expect(await listResolveOrders(prisma, partner, { organizationId: 'orgA' })).toEqual([]);
  });

  it('admin lists orders for any org', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'ord1', orderNumber: '12', title: 'Курс' }]);
    const prisma = { order: { findMany } } as never;
    const res = await listResolveOrders(prisma, admin, { organizationId: 'orgZ' });
    expect(res).toEqual([{ id: 'ord1', orderNumber: '12', title: 'Курс' }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'orgZ' } }));
  });

  it('scoped manager lists orders for an in-scope org', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { order: { findMany } } as never;
    await listResolveOrders(prisma, manager, { organizationId: 'orgA' });
    expect(findMany).toHaveBeenCalledOnce();
  });

  it('scoped manager gets [] for an out-of-scope org without querying', async () => {
    const findMany = vi.fn();
    const prisma = { order: { findMany } } as never;
    expect(await listResolveOrders(prisma, manager, { organizationId: 'orgB' })).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
