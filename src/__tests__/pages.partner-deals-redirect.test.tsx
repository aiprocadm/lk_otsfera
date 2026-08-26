// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { permanentRedirect } = vi.hoisted(() => ({
  permanentRedirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
}));
vi.mock('next/navigation', () => ({ permanentRedirect }));

import PartnerDealsRedirect from '@/app/partner/deals/page';
import PartnerDealDetailRedirect from '@/app/partner/deals/[id]/page';

beforeEach(() => {
  permanentRedirect.mockClear();
});

/**
 * `У-109`: раздел партнёра назывался «Сделки», хотя показывал заказы. При этом
 * сущность `Deal` в системе есть — то есть это была не синонимия, а прямая
 * ошибка: человек читал «Сделки» и думал про воронку продаж.
 *
 * У людей остались закладки и ссылки в письмах, поэтому старый адрес живёт
 * дальше — но постоянным редиректом (308), а не копией экрана.
 */
describe('старые адреса «Сделок» партнёра (У-109)', () => {
  it('список ведёт на «Заказы» постоянным редиректом', () => {
    expect(() => PartnerDealsRedirect()).toThrow('REDIRECT');
    expect(permanentRedirect).toHaveBeenCalledWith('/partner/orders');
  });

  it('закладка на конкретный заказ доводит до него же, а не до списка', async () => {
    await expect(
      PartnerDealDetailRedirect({ params: Promise.resolve({ id: 'ord-7' }) })
    ).rejects.toThrow('REDIRECT');
    expect(permanentRedirect).toHaveBeenCalledWith('/partner/orders/ord-7');
  });
});
