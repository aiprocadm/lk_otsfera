import { it, expect, vi, beforeEach } from 'vitest';

const { requireManagerLeader, upsertSalesTarget, notFoundIfDisabled } = vi.hoisted(() => ({
  requireManagerLeader: vi.fn(),
  upsertSalesTarget: vi.fn(),
  notFoundIfDisabled: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));
vi.mock('@/lib/services/leader/analytics', () => ({ upsertSalesTarget }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import { prisma } from '@/lib/db/prisma';
import { upsertSalesTargetAction } from '@/server-actions/leader/analytics';

const session = { sub: 'u1', role: 'manager', managerRole: 'leader', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManagerLeader.mockResolvedValue(session);
});

it('returns disabled when the leader_analytics flag is off, without checking auth', async () => {
  notFoundIfDisabled.mockReturnValue(new Response(null, { status: 404 }));

  const res = await upsertSalesTargetAction({
    managerId: 'm1',
    year: 2026,
    month: 7,
    targetAmount: '1000.00',
  });

  expect(res).toEqual({ ok: false, error: 'disabled' });
  expect(notFoundIfDisabled).toHaveBeenCalledWith('leader_analytics');
  expect(requireManagerLeader).not.toHaveBeenCalled();
  expect(upsertSalesTarget).not.toHaveBeenCalled();
});

it('delegates to upsertSalesTarget with the leader session when the flag is on', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  upsertSalesTarget.mockResolvedValue({ ok: true });

  const args = { managerId: 'm1', year: 2026, month: 7, targetAmount: '1000.00' };
  const res = await upsertSalesTargetAction(args);

  expect(requireManagerLeader).toHaveBeenCalledOnce();
  expect(upsertSalesTarget).toHaveBeenCalledWith(prisma, session, args);
  expect(res).toEqual({ ok: true });
});

it('propagates a service-level error result (e.g. invalid amount) unchanged', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  upsertSalesTarget.mockResolvedValue({ ok: false, error: 'invalid' });

  const res = await upsertSalesTargetAction({
    managerId: 'm1',
    year: 2026,
    month: 7,
    targetAmount: '-5',
  });

  expect(res).toEqual({ ok: false, error: 'invalid' });
});
