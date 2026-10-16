import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Создать заказ» без лида (этап 6 ТЗ 13.10.2026, `У-306`): действие только
 * проверяет форму входа и зовёт сервис; права и охват — в сервисе.
 */
const { requireSession, revalidatePath, createOrderDirect } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  revalidatePath: vi.fn(),
  createOrderDirect: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/manager/orderCreate', () => ({ createOrderDirect }));

import { createOrderAction } from '@/server-actions/orders/create';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
});

describe('createOrderAction', () => {
  it('кривая форма — validation, сервис не зовётся', async () => {
    expect(
      await createOrderAction({ organizationId: '', title: 'x', serviceType: 'training' })
    ).toEqual({ ok: false, error: 'validation' });
    expect(
      await createOrderAction({
        organizationId: 'o1',
        title: 'x',
        serviceType: 'стройка' as never,
      })
    ).toEqual({ ok: false, error: 'validation' });
    expect(createOrderDirect).not.toHaveBeenCalled();
  });

  it('успех — id заказа и обновлённый список; отказ сервиса — как есть', async () => {
    createOrderDirect.mockResolvedValue({ ok: true, orderId: 'ord-1' });
    const input = { organizationId: 'o1', title: 'Т', serviceType: 'training' as const };
    expect(await createOrderAction(input)).toEqual({ ok: true, orderId: 'ord-1' });
    expect(createOrderDirect).toHaveBeenCalledWith({}, SESSION, input);
    expect(revalidatePath).toHaveBeenCalledWith('/manager/orders');
    createOrderDirect.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await createOrderAction(input)).toEqual({ ok: false, error: 'not_found' });
  });
});
