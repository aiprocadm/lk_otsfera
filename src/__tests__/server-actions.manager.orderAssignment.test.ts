import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  requireManagerLeader,
  revalidatePath,
  orderFindUnique,
  claimOrder,
  assignOrderManager
} = vi.hoisted(() => ({
  requireManager: vi.fn(),
  requireManagerLeader: vi.fn(),
  revalidatePath: vi.fn(),
  orderFindUnique: vi.fn(),
  claimOrder: vi.fn(),
  assignOrderManager: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager, requireManagerLeader }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { order: { findUnique: orderFindUnique } } }));
vi.mock('@/lib/services/manager/distribution', () => ({ claimOrder, assignOrderManager }));

import {
  claimOrderAction,
  assignOrderManagerLeaderAction
} from '@/server-actions/manager/orderAssignment';

const MGR = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };
const LEADER = { sub: 'ldr-1', role: 'manager', managerRole: 'leader', managedOrgIds: [], companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(MGR);
  requireManagerLeader.mockResolvedValue(LEADER);
});

describe('claimOrderAction', () => {
  it('validation when orderId is empty', async () => {
    const res = await claimOrderAction({ orderId: '' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(claimOrder).not.toHaveBeenCalled();
  });

  it('claims and revalidates', async () => {
    claimOrder.mockResolvedValue({ ok: true, changed: true });
    const res = await claimOrderAction({ orderId: 'o1' });
    expect(res).toEqual({ ok: true, changed: true });
    expect(claimOrder).toHaveBeenCalledWith(expect.anything(), MGR, { orderId: 'o1' });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/o1');
  });

  it('passes through already_assigned', async () => {
    claimOrder.mockResolvedValue({ ok: false, error: 'already_assigned' });
    const res = await claimOrderAction({ orderId: 'o1' });
    expect(res).toEqual({ ok: false, error: 'already_assigned' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('passes through forbidden (out-of-scope claim, C8 guard)', async () => {
    claimOrder.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await claimOrderAction({ orderId: 'o1' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('assignOrderManagerLeaderAction', () => {
  it('validation when orderId is empty', async () => {
    const res = await assignOrderManagerLeaderAction({ orderId: '', managerUserId: 'm-2' });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('order_not_found when order is missing', async () => {
    orderFindUnique.mockResolvedValue(null);
    const res = await assignOrderManagerLeaderAction({ orderId: 'x', managerUserId: 'm-2' });
    expect(res).toEqual({ ok: false, error: 'order_not_found' });
    expect(assignOrderManager).not.toHaveBeenCalled();
  });

  it('forbidden when the order belongs to another company', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-OTHER' });
    const res = await assignOrderManagerLeaderAction({ orderId: 'o1', managerUserId: 'm-2' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(assignOrderManager).not.toHaveBeenCalled();
  });

  it('assigns within the same company and revalidates', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    assignOrderManager.mockResolvedValue({ ok: true, changed: true });
    const res = await assignOrderManagerLeaderAction({ orderId: 'o1', managerUserId: 'm-2' });
    expect(res).toEqual({ ok: true, changed: true });
    expect(assignOrderManager).toHaveBeenCalledWith(expect.anything(), LEADER, {
      orderId: 'o1',
      managerUserId: 'm-2',
      restrictToCompanyId: 'co-1'
    });
    expect(revalidatePath).toHaveBeenCalledWith('/leader/orders/o1');
  });

  it('passes through invalid_manager from the service', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    assignOrderManager.mockResolvedValue({ ok: false, error: 'invalid_manager' });
    const res = await assignOrderManagerLeaderAction({ orderId: 'o1', managerUserId: 'nope' });
    expect(res).toEqual({ ok: false, error: 'invalid_manager' });
  });
});
