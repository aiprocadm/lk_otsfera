import { beforeEach, describe, expect, it, vi } from 'vitest';

// §10 ТЗ v0.5 (этап 2, PR-4): экшен перехода статуса удалён — статус меняется
// через server-actions/orderStatuses.ts поверх справочника. Здесь остались
// проверки отметки бухгалтерии.
const { requireManager, revalidatePath, setOrderAccountingSigned } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  revalidatePath: vi.fn(),
  setOrderAccountingSigned: vi.fn()
}));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/orderLifecycle', () => ({
  setOrderAccountingSigned
}));

import { setOrderAccountingSignedAction } from '@/server-actions/manager/orderLifecycle';

const SESSION = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(SESSION);
});

describe('setOrderAccountingSignedAction', () => {
  it('validation when signed is missing — bare stable code, no zod details (R2)', async () => {
    const res = await setOrderAccountingSignedAction({ orderId: 'o1' } as never);
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(setOrderAccountingSigned).not.toHaveBeenCalled();
  });

  it('marks accounting signed and revalidates', async () => {
    setOrderAccountingSigned.mockResolvedValue({ ok: true, changed: true });
    const res = await setOrderAccountingSignedAction({ orderId: 'o1', signed: true });
    expect(res).toEqual({ ok: true, changed: true });
    expect(setOrderAccountingSigned).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'o1',
      signed: true
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/o1');
  });

  it('passes through not_found', async () => {
    setOrderAccountingSigned.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await setOrderAccountingSignedAction({ orderId: 'x', signed: false });
    expect(res).toEqual({ ok: false, error: 'not_found' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
