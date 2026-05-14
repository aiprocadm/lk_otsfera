import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  findMany,
  findUnique,
  update,
  requireSession,
  requireOrderAccess,
  requireRole,
  getPrimaryOrganizationId,
  notifyStatusChanged,
  triggerNotificationEmail
} = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  requireSession: vi.fn(),
  requireOrderAccess: vi.fn(),
  requireRole: vi.fn(),
  getPrimaryOrganizationId: vi.fn(),
  notifyStatusChanged: vi.fn(),
  triggerNotificationEmail: vi.fn()
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { order: { findMany, findUnique, update } } }));
vi.mock('@/lib/auth/guard', () => ({ requireSession, requireOrderAccess, requireRole }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId }));
vi.mock('@/lib/notifications', () => ({ notifyStatusChanged, triggerNotificationEmail }));

import { GET } from '@/app/api/orders/route';
import { PATCH } from '@/app/api/orders/[id]/route';

describe('orders visibility', () => {
  beforeEach(() => vi.resetAllMocks());

  it('admin sees all orders', async () => {
    requireSession.mockResolvedValue({ ok: true, value: { role: 'admin', sub: 'u1' } });
    requireRole.mockReturnValue({ ok: true, value: { role: 'admin', sub: 'u1' } });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('partner sees linked organizations only', async () => {
    requireSession.mockResolvedValue({ ok: true, value: { role: 'partner', sub: 'u2', partnerId: 'p1' } });
    requireRole.mockReturnValue({ ok: true, value: { role: 'partner', sub: 'u2', partnerId: 'p1' } });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company: { organizations: { some: { partnerId: 'p1' } } } }
    }));
  });

  it('organization sees own organization data only', async () => {
    requireSession.mockResolvedValue({ ok: true, value: { role: 'organization', sub: 'u3', organizationId: 'o1' } });
    requireRole.mockReturnValue({ ok: true, value: { role: 'organization', sub: 'u3', organizationId: 'o1' } });
    findMany.mockResolvedValue([]);
    await GET(new Request('https://app.local/api/orders'));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { company: { organizations: { some: { id: 'o1' } } } }
    }));
  });
});

describe('orders patch status validation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: { sub: 'u1', partnerId: 'p1' } });
    findUnique.mockResolvedValue({ id: 'o1', title: 'Order 1', status: 'new' });
    requireRole.mockReturnValue({ ok: true, value: { sub: 'u1', partnerId: 'p1' } });
    requireOrderAccess.mockResolvedValue({ ok: true });
    getPrimaryOrganizationId.mockResolvedValue('org1');
    notifyStatusChanged.mockResolvedValue(undefined);
    triggerNotificationEmail.mockResolvedValue(undefined);
  });

  it('valid status returns 200', async () => {
    update.mockResolvedValue({ id: 'o1', title: 'Order 1', status: 'completed' });

    const response = await PATCH(new Request('https://app.local/api/orders/o1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
      headers: { 'content-type': 'application/json' }
    }), { params: { id: 'o1' } });

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'completed' } });
  });

  it('invalid status returns 400', async () => {
    const response = await PATCH(new Request('https://app.local/api/orders/o1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'bad_status' }),
      headers: { 'content-type': 'application/json' }
    }), { params: { id: 'o1' } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_STATUS' });
    expect(update).not.toHaveBeenCalled();
  });

  it('missing status returns 400', async () => {
    const response = await PATCH(new Request('https://app.local/api/orders/o1', {
      method: 'PATCH',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' }
    }), { params: { id: 'o1' } });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_STATUS' });
    expect(update).not.toHaveBeenCalled();
  });
});
