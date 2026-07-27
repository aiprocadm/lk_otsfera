import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 12 (ФТ-5.1/5.2) — server-actions передачи результата: тонкий адаптер
 * (§3 CLAUDE.md) — валидация входа, роль, ревалидация деталок обеих сторон.
 */

const { requireManager } = vi.hoisted(() => ({ requireManager: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { deliverOrderResult, approveDeliverables } = vi.hoisted(() => ({
  deliverOrderResult: vi.fn(),
  approveDeliverables: vi.fn()
}));
vi.mock('@/lib/services/manager/orderDelivery', () => ({
  deliverOrderResult,
  approveDeliverables
}));

import {
  deliverOrderResultAction,
  approveDeliverablesAction
} from '@/server-actions/manager/orderDelivery';

const session = { sub: 'm1', role: 'manager' };

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(session);
});

describe('deliverOrderResultAction', () => {
  it('пустой orderId → validation, сервис не зовётся', async () => {
    expect(await deliverOrderResultAction({ orderId: '' })).toEqual({
      ok: false,
      error: 'validation'
    });
    expect(deliverOrderResult).not.toHaveBeenCalled();
  });

  it('успех: дата строкой + ревалидация деталок сотрудника и клиента', async () => {
    const at = new Date('2026-07-27T10:00:00Z');
    deliverOrderResult.mockResolvedValue({ ok: true, deliveredAt: at, alreadyDelivered: false });

    const res = await deliverOrderResultAction({ orderId: 'o1' });
    expect(res).toEqual({ ok: true, deliveredAt: at.toISOString(), alreadyDelivered: false });

    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toContain('/manager/orders/o1');
    expect(paths).toContain('/leader/orders/o1');
    expect(paths).toContain('/organization/orders/o1');
    expect(paths).toContain('/partner/deals/o1');
  });

  it('not_ready прокидывает расшифровку готовности', async () => {
    const readiness = { ready: false, gaps: ['items_not_ready'], items: [] };
    deliverOrderResult.mockResolvedValue({ ok: false, error: 'not_ready', readiness });
    const res = await deliverOrderResultAction({ orderId: 'o1' });
    expect(res).toEqual({ ok: false, error: 'not_ready', readiness });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('forbidden пробрасывается без ревалидации', async () => {
    deliverOrderResult.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await deliverOrderResultAction({ orderId: 'o1' })).toEqual({
      ok: false,
      error: 'forbidden'
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('approveDeliverablesAction', () => {
  it('валидация входа', async () => {
    expect(await approveDeliverablesAction({ orderId: '' })).toEqual({
      ok: false,
      error: 'validation'
    });
    expect(approveDeliverables).not.toHaveBeenCalled();
  });

  it('успех: дата строкой + ревалидация', async () => {
    const at = new Date('2026-07-27T09:00:00Z');
    approveDeliverables.mockResolvedValue({ ok: true, approvedAt: at });
    expect(await approveDeliverablesAction({ orderId: 'o1' })).toEqual({
      ok: true,
      approvedAt: at.toISOString()
    });
    expect(revalidatePath).toHaveBeenCalled();
  });

  it('ошибка сервиса пробрасывается', async () => {
    approveDeliverables.mockResolvedValue({ ok: false, error: 'not_found' });
    expect(await approveDeliverablesAction({ orderId: 'o1' })).toEqual({
      ok: false,
      error: 'not_found'
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
