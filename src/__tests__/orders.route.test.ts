import { beforeEach, describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
const getSession = vi.fn();

vi.mock('@/lib/db/prisma', () => ({ prisma: { order: { findMany } } }));
vi.mock('@/lib/auth/session', () => ({ getSession }));

import { GET } from '@/app/api/orders/route';

describe('orders visibility', () => {
  beforeEach(() => vi.resetAllMocks());

  it('admin sees all orders', async () => {
    getSession.mockResolvedValue({ role: 'admin', sub: 'u1' });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('partner sees linked organizations only', async () => {
    getSession.mockResolvedValue({ role: 'partner', sub: 'u2', partnerId: 'p1' });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company: { organizations: { some: { partnerId: 'p1' } } } }
    }));
  });

  it('organization sees own organization data only', async () => {
    getSession.mockResolvedValue({ role: 'organization', sub: 'u3', organizationId: 'o1' });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company: { organizations: { some: { id: 'o1' } } } }
    }));
  });
});
