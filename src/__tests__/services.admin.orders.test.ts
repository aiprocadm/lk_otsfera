import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { getOrderForAdmin } from '@/lib/services/admin/orders';

/**
 * Аудит A1: чтение карточки заказа уехало со страницы /admin/orders/[id] в
 * сервис — здесь пиннится форма запроса (включая набор связей).
 */
function makePrisma(findUnique: ReturnType<typeof vi.fn>) {
  return { order: { findUnique } } as unknown as PrismaClient;
}

describe('getOrderForAdmin()', () => {
  it('тянет заказ с организацией, партнёром и менеджером', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'order-1' });

    const order = await getOrderForAdmin(makePrisma(findUnique), 'order-1');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      include: {
        organization: { select: { id: true, name: true } },
        partner: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true, email: true } },
      },
    });
    expect(order).toEqual({ id: 'order-1' });
  });

  it('отдаёт null, когда заказа нет', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    expect(await getOrderForAdmin(makePrisma(findUnique), 'missing')).toBeNull();
  });
});
