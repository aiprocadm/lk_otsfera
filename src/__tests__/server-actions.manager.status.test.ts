import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireManager,
  revalidatePath,
  orderFindUnique,
  orderUpdate,
  auditLogCreate,
  userFindUnique,
  notifyOrgUsers,
  notifyManagers
} = vi.hoisted(() => ({
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  userFindUnique: vi.fn(),
  notifyOrgUsers: vi.fn(),
  notifyManagers: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique, update: orderUpdate },
    auditLog: { create: auditLogCreate },
    user: { findUnique: userFindUnique }
  }
}));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));

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
  notifyManagers.mockResolvedValue({ recipientsNotified: 0, emailsSent: 0, emailsSkipped: 0 });
  auditLogCreate.mockResolvedValue({});
  orderUpdate.mockResolvedValue({});
  userFindUnique.mockResolvedValue({ name: 'Иван Менеджеров' });
});

describe('transitionOrderStatusAction — input validation', () => {
  it('returns validation error for empty orderId', async () => {
    const res = await transitionOrderStatusAction({ orderId: '', newStatus: 'in_progress' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('returns validation error for unsupported status cancelled', async () => {
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'cancelled' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
    expect(orderFindUnique).not.toHaveBeenCalled();
    expect(notifyManagers).not.toHaveBeenCalled();
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

    // notifyManagers fans out to peer managers in scope of this order, with
    // the actor excluded so the originator isn't notified about their own
    // action.
    expect(notifyManagers).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      {
        orderId: 'order-1',
        type: 'order_status_changed_by_manager',
        payload: {
          actorName: 'Иван Менеджеров',
          oldStatus: 'pending',
          newStatus: 'in_progress'
        }
      },
      { excludeUserId: 'mgr-1' }
    );

    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/order-1');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders');
    expect(revalidatePath).toHaveBeenCalledWith('/manager/dashboard');
    // Лидер меняет статус из своего кабинета — leader-маршруты тоже инвалидируются (R3).
    expect(revalidatePath).toHaveBeenCalledWith('/leader/orders/order-1');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/orders');
    expect(revalidatePath).toHaveBeenCalledWith('/leader/dashboard');
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

  // PRODUCT DECISION (2026-06-06): a manager MAY reopen a completed order back
  // to pending. This is intentional, not a bug. This test is the regression
  // lock — it fails if anyone adds a guard blocking completed → pending.
  it('ALLOWS reopening: completed → pending succeeds and clears completedAt', async () => {
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'completed' }));
    const res = await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'pending' });

    expect(res).toEqual({ ok: true, changed: true });
    const data = orderUpdate.mock.calls[0]![0]!.data;
    expect(data.executionStatus).toBe('pending');
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
    // The no-op path short-circuits before any fan-out, so peer managers are
    // not notified for an idempotent retry.
    expect(notifyManagers).not.toHaveBeenCalled();
    // Still revalidates: cheap, and harmless for unchanged state (3 manager + 3 leader).
    expect(revalidatePath).toHaveBeenCalledTimes(6);
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
    expect(notifyManagers).not.toHaveBeenCalled();
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
    expect(notifyManagers).not.toHaveBeenCalled();
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
    // notifyManagers still fires — the actor (mgr-2) is excluded by
    // excludeUserId, leaving only any peer managers in the recipient set.
    expect(notifyManagers).toHaveBeenCalledTimes(1);
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'order_status_changed_by_manager',
        payload: expect.objectContaining({ oldStatus: 'pending', newStatus: 'in_progress' })
      }),
      { excludeUserId: 'mgr-2' }
    );
  });
});

describe('transitionOrderStatusAction — non-domain error re-throw', () => {
  it('re-throws non-domain errors (e.g. DB connectivity failure)', async () => {
    orderFindUnique.mockRejectedValue(new Error('DB connection reset'));
    await expect(
      transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'in_progress' })
    ).rejects.toThrow('DB connection reset');
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
    // notifyManagers is NOT gated on organizationId — the per-order managerId
    // (and historical-comment) recipient paths still apply, so the call is
    // made even for orgless orders.
    expect(notifyManagers).toHaveBeenCalledTimes(1);
  });

  it('falls back to "Менеджер" when actor user has no name', async () => {
    userFindUnique.mockResolvedValue({ name: null });
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'pending' }));
    await transitionOrderStatusAction({ orderId: 'order-1', newStatus: 'in_progress' });

    expect(notifyManagers).toHaveBeenCalledTimes(1);
    const call = notifyManagers.mock.calls[0]!;
    expect(call[1]).toMatchObject({
      type: 'order_status_changed_by_manager',
      payload: expect.objectContaining({ actorName: 'Менеджер' })
    });
  });

  it('does not roll back the status update when notifyManagers throws', async () => {
    // Best-effort contract: the audit row + order.update are the source of
    // truth — a downstream notification failure must not surface as an error
    // to the user.
    notifyManagers.mockRejectedValue(new Error('email pipeline down'));
    orderFindUnique.mockResolvedValue(inScopeOrder({ executionStatus: 'pending' }));
    const res = await transitionOrderStatusAction({
      orderId: 'order-1',
      newStatus: 'in_progress'
    });
    expect(res).toEqual({ ok: true, changed: true });
    expect(orderUpdate).toHaveBeenCalledTimes(1);
    expect(auditLogCreate).toHaveBeenCalledTimes(1);
  });
});
