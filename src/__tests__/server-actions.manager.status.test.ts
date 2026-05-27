import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  revalidatePath,
  orderFindUnique,
  orderUpdate,
  auditLogCreate,
  notifyOrgUsers
} = vi.hoisted(() => ({
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  notifyOrgUsers: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    auditLog: { create: auditLogCreate }
  }
}));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));

import { transitionOrderStatusAction } from '@/server-actions/manager/transitionOrderStatus';

const SESSION = { sub: 'mgr-1', role: 'manager', managedOrgIds: ['org-1'] };

function inScopeOrder(overrides: Partial<{
  id: string;
  managerId: string | null;
  organizationId: string | null;
  executionStatus: string;
  orderNumber: string | null;
  title: string;
}> = {}) {
  return {
    id: 'order-1',
    managerId: null,
    organizationId: 'org-1',
    executionStatus: 'pending',
    orderNumber: 'O-001',
    title: 'Test Order',
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(SESSION);
  // Sensible default — most tests use the no-op `pending` resolution unless
  // they set a more specific value.
  notifyOrgUsers.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 1 });
  auditLogCreate.mockResolvedValue({});
  orderUpdate.mockResolvedValue({});
});

describe('transitionOrderStatusAction — input validation', () => {
  it('returns validation error for empty orderId', async () => {
    const res = await transitionOrderStatusAction({ orderId: '', newStatus: 'in_progress' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns validation error for unsupported status cancelled', async () => {
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'cancelled' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(orderFindUnique).not.toHaveBeenCalled();
  });

  it('returns validation error for unsupported status on_hold', async () => {
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'on_hold' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('returns validation error for nonsense status string', async () => {
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'banana' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });
});

describe('transitionOrderStatusAction — happy path: pending → in_progress on in-scope order', () => {
  it('updates the order, writes audit, fans out org notifications, and revalidates 3 paths', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'pending' }));
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'in_progress' });

    expect(res).toEqual({ ok: true, changed: true });

    expect(orderUpdate).toHaveBeenCalledTimes(1);
    const updateArg = orderUpdate.mock.calls[0]![0]!;
    expect(updateArg).toMatchObject({
      where: { id: 'order-1' },
      data: { executionStatus: 'in_progress' }
    });
    // Neither completed-entry nor completed-exit branch should trigger here.
    expect(updateArg.data).not.toHaveProperty('completedAt');

    expect(auditLogCreate).toHaveBeenCalledTimes(1);
    const auditArg = auditLogCreate.mock.calls[0]![0]!.data;
    expect(auditArg).toMatchObject({
      userId: 'mgr-1',
      action: 'order_status_changed',
      entity: 'order',
      entityId: 'order-1'
    });
    expect(auditArg.meta).toMatchObject({
      status: 'success',
      before: { executionStatus: 'pending' },
      after: { executionStatus: 'in_progress', actor: 'manager' }
    });

    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsers).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      type: 'order_status_changed',
      payload: {
        orderId: 'order-1',
        orderNumber: 'O-001',
        orderTitle: 'Test Order',
        dimension: 'execution',
        oldStatus: 'pending',
        newStatus: 'in_progress'
      }
    });

    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/order-1');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/dashboard');
  });
});

describe('transitionOrderStatusAction — completedAt management', () => {
  it('sets completedAt when transitioning to completed', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'in_progress' }));
    const before = Date.now();
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'completed' });
    const after = Date.now();

    expect(res).toEqual({ ok: true, changed: true });
    const data = orderUpdate.mock.calls[0]![0]!.data;
    expect(data.executionStatus).toBe('completed');
    expect(data.completedAt).toBeInstanceOf(Date);
    const t = (data.completedAt as Date).getTime();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it('clears completedAt when transitioning out of completed', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'completed' }));
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'in_progress' });

    expect(res).toEqual({ ok: true, changed: true });
    const data = orderUpdate.mock.calls[0]![0]!.data;
    expect(data.executionStatus).toBe('in_progress');
    expect(data.completedAt).toBeNull();
  });

  it('does not touch completedAt on pending → in_progress', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'pending' }));
    await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'in_progress' });
    const data = orderUpdate.mock.calls[0]![0]!.data;
    expect(data).not.toHaveProperty('completedAt');
  });
});

describe('transitionOrderStatusAction — no-op when status unchanged', () => {
  it('returns changed:false and skips DB write / audit / notifications', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'in_progress' }));
    const res = await transitionOrderStatusAction({
      orderId: 'order-1',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: true, changed: false });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(auditLogCreate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    // Still revalidates: cheap, and harmless for unchanged state.
    expect(revalidatePath).toHaveBeenCalledTimes(3);
  });
});

describe('transitionOrderStatusAction — forbidden / not_found', () => {
  it('returns forbidden when order is out of scope (different org, no managerId, no comments)', async () => {
    orderFindUnique.mockResolvedValue(
      inScopeOrder({ id: 'order-foreign', organizationId: 'org-other', managerId: null })
    );
    const res = await transitionOrderStatusAction({
      orderId: 'order-foreign',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns not_found when order does not exist', async () => {
    orderFindUnique.mockResolvedValue(null);
    const res = await transitionOrderStatusAction({
      orderId: 'order-missing',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('allows transition via per-order managerId even without org scope', async () => {
    requireManager.mockResolvedValue({ sub: 'mgr-2', role: 'manager', managedOrgIds: [] });
    orderFindUnique.mockResolvedValue(
      inScopeOrder({ organizationId: 'org-other', managerId: 'mgr-2' })
    );
    const res = await transitionOrderStatusAction({
      orderId: 'order-1',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: true, changed: true });
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsers).toHaveBeenCalledTimes(1);
  });
});

describe('transitionOrderStatusAction — notification fan-out edge cases', () => {
  it('skips notifyOrgUsers when order has no organizationId', async () => {
    // organizationId is non-null per schema, but defensive coverage for the
    // service's null guard keeps the contract explicit.
    orderFindUnique.mockResolvedValue(inScopeOrder({ organizationId: null, managerId: 'mgr-1' }));
    const res = await transitionOrderStatusAction({
      orderId: 'order-1',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: true, changed: true });
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });
});
