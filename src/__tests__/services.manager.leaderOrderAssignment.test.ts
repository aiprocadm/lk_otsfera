/**
 * Unit-тесты сервиса `assignOrderManagerAsLeader`
 * (src/lib/services/manager/leaderOrderAssignment.ts): C8-граница компании на
 * заявке и сужение кандидата через restrictToCompanyId. Прокидка Result и
 * revalidatePath — в server-actions.manager.orderAssignment.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { orderFindUnique, assignOrderManager } = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  assignOrderManager: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { order: { findUnique: orderFindUnique } } }));
vi.mock('@/lib/services/manager/distribution', () => ({ assignOrderManager }));

import { prisma } from '@/lib/db/prisma';
import { assignOrderManagerAsLeader } from '@/lib/services/manager/leaderOrderAssignment';

const LEADER: SessionPayload = {
  sub: 'ldr-1',
  role: 'leader',
  managedOrgIds: [],
  companyId: 'co-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assignOrderManagerAsLeader', () => {
  it('order_not_found when order is missing', async () => {
    orderFindUnique.mockResolvedValue(null);
    const res = await assignOrderManagerAsLeader(prisma, LEADER, {
      orderId: 'x',
      managerUserId: 'm-2',
    });
    expect(res).toEqual({ ok: false, error: 'order_not_found' });
    expect(assignOrderManager).not.toHaveBeenCalled();
  });

  it('forbidden when the order belongs to another company (C8)', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-OTHER' });
    const res = await assignOrderManagerAsLeader(prisma, LEADER, {
      orderId: 'o1',
      managerUserId: 'm-2',
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(assignOrderManager).not.toHaveBeenCalled();
  });

  it('forbidden when the leader session carries no company', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    const res = await assignOrderManagerAsLeader(
      prisma,
      { ...LEADER, companyId: null },
      { orderId: 'o1', managerUserId: 'm-2' }
    );
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(assignOrderManager).not.toHaveBeenCalled();
  });

  it('assigns within the same company, narrowing the candidate by restrictToCompanyId', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    assignOrderManager.mockResolvedValue({ ok: true, changed: true });

    const res = await assignOrderManagerAsLeader(prisma, LEADER, {
      orderId: 'o1',
      managerUserId: 'm-2',
    });

    expect(res).toEqual({ ok: true, changed: true });
    expect(orderFindUnique).toHaveBeenCalledWith({
      where: { id: 'o1' },
      select: { companyId: true },
    });
    expect(assignOrderManager).toHaveBeenCalledWith(prisma, LEADER, {
      orderId: 'o1',
      managerUserId: 'm-2',
      restrictToCompanyId: 'co-1',
    });
  });

  it('passes through invalid_manager from the shared service', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    assignOrderManager.mockResolvedValue({ ok: false, error: 'invalid_manager' });
    const res = await assignOrderManagerAsLeader(prisma, LEADER, {
      orderId: 'o1',
      managerUserId: 'nope',
    });
    expect(res).toEqual({ ok: false, error: 'invalid_manager' });
  });

  it('unassign (managerUserId=null) идёт тем же путём', async () => {
    orderFindUnique.mockResolvedValue({ companyId: 'co-1' });
    assignOrderManager.mockResolvedValue({ ok: true, changed: true });

    await assignOrderManagerAsLeader(prisma, LEADER, { orderId: 'o1', managerUserId: null });

    expect(assignOrderManager).toHaveBeenCalledWith(
      prisma,
      LEADER,
      expect.objectContaining({ managerUserId: null, restrictToCompanyId: 'co-1' })
    );
  });
});
