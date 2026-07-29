/**
 * §10 ТЗ v0.5 (этап 2, PR-3) — экшен смены статуса с карточки.
 * Экшен тонкий: валидация входа + сервис + revalidate. Права — в сервисе.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

const { transitionOrderStatus } = vi.hoisted(() => ({ transitionOrderStatus: vi.fn() }));
vi.mock('@/lib/services/orderStatuses', () => ({ transitionOrderStatus }));

import { transitionOrderStatusAction } from '@/server-actions/orderStatuses';

const SESSION = { sub: 'm1', role: 'manager' };

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue(SESSION);
  transitionOrderStatus.mockReset();
  revalidatePath.mockClear();
});

describe('transitionOrderStatusAction', () => {
  it('успех освежает карточку во всех кабинетах', async () => {
    transitionOrderStatus.mockResolvedValue({ ok: true, changed: true, statusId: 'c' });

    const res = await transitionOrderStatusAction({ orderId: 'o1', toId: 'c' });

    expect(res).toEqual({ ok: true, changed: true });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/manager/orders/o1');
    expect(paths).toContain('/leader/orders/o1');
    expect(paths).toContain('/admin/orders/o1');
  });

  it('причина передаётся сервису как есть', async () => {
    transitionOrderStatus.mockResolvedValue({ ok: true, changed: true, statusId: 'x' });
    await transitionOrderStatusAction({ orderId: 'o1', toId: 'x', reason: 'отказ' });
    expect(transitionOrderStatus).toHaveBeenCalledWith({}, SESSION, {
      orderId: 'o1',
      toId: 'x',
      reason: 'отказ'
    });
  });

  it('пустой ввод отклоняется до сервиса', async () => {
    const res = await transitionOrderStatusAction({ orderId: '', toId: '' });
    expect(res).toEqual({ ok: false, error: 'validation' });
    expect(transitionOrderStatus).not.toHaveBeenCalled();
  });

  it('слишком длинная причина отклоняется', async () => {
    const res = await transitionOrderStatusAction({
      orderId: 'o1',
      toId: 'x',
      reason: 'x'.repeat(1001)
    });
    expect(res).toEqual({ ok: false, error: 'validation' });
  });

  it('отказ сервиса пробрасывается и кэш не трогается', async () => {
    transitionOrderStatus.mockResolvedValue({ ok: false, error: 'backward_forbidden' });
    const res = await transitionOrderStatusAction({ orderId: 'o1', toId: 'd' });
    expect(res).toEqual({ ok: false, error: 'backward_forbidden' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('невыполненные условия закрытия доходят до карточки со списком', async () => {
    transitionOrderStatus.mockResolvedValue({
      ok: false,
      error: 'completion_conditions_unmet',
      unmet: ['accounting_signed']
    });
    const res = await transitionOrderStatusAction({ orderId: 'o1', toId: 'c' });
    expect(res).toEqual({
      ok: false,
      error: 'completion_conditions_unmet',
      unmet: ['accounting_signed']
    });
  });
});
