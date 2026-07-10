import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireManager, revalidatePath, transitionOrderLifecycle, setOrderAccountingSigned } =
  vi.hoisted(() => ({
    requireManager: vi.fn(),
    revalidatePath: vi.fn(),
    transitionOrderLifecycle: vi.fn(),
    setOrderAccountingSigned: vi.fn()
  }));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/orderLifecycle', () => ({
  transitionOrderLifecycle,
  setOrderAccountingSigned
}));

import {
  transitionOrderLifecycleAction,
  setOrderAccountingSignedAction
} from '@/server-actions/manager/orderLifecycle';

const SESSION = { sub: 'mgr-1', role: 'manager', managedOrgIds: [], companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(SESSION);
});

describe('transitionOrderLifecycleAction', () => {
  it('validation when orderId is empty (service not called) — bare stable code, no zod details (R2)', async () => {
    const res = await transitionOrderLifecycleAction({ orderId: '', to: 'in_progress' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(transitionOrderLifecycle).not.toHaveBeenCalled();
  });

  it('validation for an unknown target status', async () => {
    const res = await transitionOrderLifecycleAction({ orderId: 'o1', to: 'banana' });
    expect(res).toMatchObject({ ok: false, error: 'validation' });
  });

  it('maps a successful transition and revalidates', async () => {
    transitionOrderLifecycle.mockResolvedValue({ ok: true, changed: true, status: 'waiting_client' });
    const res = await transitionOrderLifecycleAction({ orderId: 'o1', to: 'waiting_client', reason: 'fix' });
    expect(res).toEqual({ ok: true, changed: true, status: 'waiting_client' });
    expect(transitionOrderLifecycle).toHaveBeenCalledWith(expect.anything(), SESSION, {
      orderId: 'o1',
      to: 'waiting_client',
      reason: 'fix'
    });
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders/o1');
  });

  it('passes through completion_conditions_unmet with unmet list', async () => {
    transitionOrderLifecycle.mockResolvedValue({
      ok: false,
      error: 'completion_conditions_unmet',
      unmet: ['accounting_signed']
    });
    const res = await transitionOrderLifecycleAction({ orderId: 'o1', to: 'completed' });
    expect(res).toEqual({ ok: false, error: 'completion_conditions_unmet', unmet: ['accounting_signed'] });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('passes through a plain error (forbidden)', async () => {
    transitionOrderLifecycle.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await transitionOrderLifecycleAction({ orderId: 'o1', to: 'in_progress' });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
  });
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
