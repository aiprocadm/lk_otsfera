/**
 * Unit tests for src/lib/services/manager/status.ts — transitionOrderStatus service.
 * The existing test (server-actions.manager.status.test.ts) tests the server-action
 * wrapper, not the service directly. This covers the service-level branches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCompanyTeamVisibility, canSeeOrder } = vi.hoisted(() => ({
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrder: vi.fn()
}));
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({
  notifyOrgUsers: vi.fn(),
  notifyManagers: vi.fn()
}));

vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));

import { transitionOrderStatus } from '@/lib/services/manager/status';
import type { SessionPayload } from '@/lib/auth/jwt';

const SESSION: SessionPayload = {
  sub: 'mgr-1',
  role: 'manager',
  managedOrgIds: ['org-1'],
  companyId: 'co-1'
};

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord-1',
    managerId: 'mgr-1',
    organizationId: 'org-1',
    companyId: 'co-1',
    executionStatus: 'pending',
    orderNumber: 'O-001',
    title: 'Test Order',
    ...overrides
  };
}

function makePrisma(order: ReturnType<typeof makeOrder> | null, overrides: Record<string, unknown> = {}) {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn().mockResolvedValue({ ...order })
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    user: { findUnique: vi.fn().mockResolvedValue({ name: 'Иванов' }) },
    ...overrides
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  recordAudit.mockResolvedValue(undefined);
  notifyOrgUsers.mockResolvedValue({ recipientsNotified: 1 });
  notifyManagers.mockResolvedValue({ recipientsNotified: 0 });
});

describe('transitionOrderStatus', () => {
  it('returns invalid_status for unsupported status', async () => {
    const p = makePrisma(makeOrder());
    expect(
      await transitionOrderStatus(p, SESSION, 'ord-1', 'cancelled' as never)
    ).toEqual({ ok: false, error: 'invalid_status' });
  });

  it('returns not_found when order does not exist', async () => {
    const p = makePrisma(null);
    expect(
      await transitionOrderStatus(p, SESSION, 'ord-nonexistent', 'in_progress')
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('returns forbidden when canSeeOrder returns false', async () => {
    canSeeOrder.mockReturnValue(false);
    const p = makePrisma(makeOrder());
    expect(
      await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress')
    ).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns { changed: false } when order is already in target status', async () => {
    const p = makePrisma(makeOrder({ executionStatus: 'in_progress' }));
    const result = await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(result).toEqual({ ok: true, changed: false });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('returns { changed: true } and writes audit on successful transition', async () => {
    const p = makePrisma(makeOrder({ executionStatus: 'pending' }));
    const result = await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(result).toEqual({ ok: true, changed: true });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'order_status_changed' })
    );
  });

  it('sets completedAt when transitioning to completed', async () => {
    const orderUpdate = vi.fn().mockResolvedValue({});
    const p = makePrisma(makeOrder({ executionStatus: 'in_progress' }), {
      order: {
        findUnique: vi.fn().mockResolvedValue(makeOrder({ executionStatus: 'in_progress' })),
        update: orderUpdate
      }
    });
    await transitionOrderStatus(p, SESSION, 'ord-1', 'completed');
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedAt: expect.any(Date) })
      })
    );
  });

  it('clears completedAt when leaving completed status', async () => {
    const orderUpdate = vi.fn().mockResolvedValue({});
    const p = makePrisma(makeOrder({ executionStatus: 'completed' }), {
      order: {
        findUnique: vi.fn().mockResolvedValue(makeOrder({ executionStatus: 'completed' })),
        update: orderUpdate
      }
    });
    await transitionOrderStatus(p, SESSION, 'ord-1', 'pending');
    expect(orderUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ completedAt: null })
      })
    );
  });

  it('skips notifyOrgUsers when organizationId is null', async () => {
    const p = makePrisma(makeOrder({ organizationId: null }));
    await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('calls notifyOrgUsers when organizationId is set', async () => {
    const p = makePrisma(makeOrder({ organizationId: 'org-1' }));
    await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: 'org-1', type: 'order_status_changed' })
    );
  });

  it('swallows notifyManagers failure (best-effort) and still returns changed=true', async () => {
    notifyManagers.mockRejectedValueOnce(new Error('email API down'));
    const p = makePrisma(makeOrder({ organizationId: 'org-1' }));
    const result = await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(result).toEqual({ ok: true, changed: true });
  });

  it('uses actorName from user lookup in notifyManagers payload', async () => {
    const userFindUnique = vi.fn().mockResolvedValue({ name: 'Петров' });
    const p = makePrisma(makeOrder({ organizationId: 'org-1' }), {
      user: { findUnique: userFindUnique }
    });
    await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ actorName: 'Петров' })
      }),
      expect.any(Object)
    );
  });

  it('falls back to "Менеджер" when user not found in notifyManagers', async () => {
    const userFindUnique = vi.fn().mockResolvedValue(null);
    const p = makePrisma(makeOrder({ organizationId: 'org-1' }), {
      user: { findUnique: userFindUnique }
    });
    await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(notifyManagers).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ actorName: 'Менеджер' })
      }),
      expect.any(Object)
    );
  });

  it('swallows non-Error throws from notifyManagers (String(err) branch)', async () => {
    // Throw a string (non-Error) to exercise the String(err) branch in the catch
    notifyManagers.mockRejectedValueOnce('network-gone');
    const p = makePrisma(makeOrder({ organizationId: 'org-1' }));
    const result = await transitionOrderStatus(p, SESSION, 'ord-1', 'in_progress');
    expect(result).toEqual({ ok: true, changed: true });
  });
});
