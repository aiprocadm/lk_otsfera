import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireSession,
  getCompanyTeamVisibility,
  notFoundIfDisabled,
  revalidatePath,
  setOrderPrimaryContact,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  revalidatePath: vi.fn(),
  setOrderPrimaryContact: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/orders/primaryContact', () => ({ setOrderPrimaryContact }));

import { setOrderPrimaryContactAction } from '@/server-actions/orders/primaryContact';

/**
 * Server action «Контакт заказа» (этап 1 ТЗ 12.09.2026, `У-180`): флаг
 * `contacts` → `forbidden` без похода за сессией; форма — zod → `validation`;
 * `teamMode` читается свежим из базы и уходит сервису; после удачной записи
 * перечитывается карточка заказа в трёх кабинетах и — если контакт назначен —
 * его карточка в тех же кабинетах.
 */
const session = { sub: 'm1', role: 'manager', companyId: 'c1' };
const cabinets = ['manager', 'leader', 'admin'];

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(session);
  getCompanyTeamVisibility.mockResolvedValue(true);
  notFoundIfDisabled.mockReturnValue(null);
  setOrderPrimaryContact.mockResolvedValue({ ok: true });
});

describe('setOrderPrimaryContactAction — флаг и форма', () => {
  it('выключенный флаг → forbidden до сессии и сервиса', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect(await setOrderPrimaryContactAction({ orderId: 'ord-1', contactId: 'k1' })).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(notFoundIfDisabled).toHaveBeenCalledWith('contacts');
    expect(requireSession).not.toHaveBeenCalled();
    expect(setOrderPrimaryContact).not.toHaveBeenCalled();
  });

  it('кривая форма (пустой заказ, пустой контакт, контакт не передан, слишком длинный id) → validation без сессии', async () => {
    expect(await setOrderPrimaryContactAction({ orderId: '', contactId: 'k1' })).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(await setOrderPrimaryContactAction({ orderId: 'ord-1', contactId: '' })).toEqual({
      ok: false,
      error: 'validation',
    });
    // «Не передан» ≠ «снять» (null): снятие должно быть явным.
    expect(await setOrderPrimaryContactAction({ orderId: 'ord-1' } as never)).toEqual({
      ok: false,
      error: 'validation',
    });
    expect(
      await setOrderPrimaryContactAction({ orderId: 'x'.repeat(65), contactId: null })
    ).toEqual({ ok: false, error: 'validation' });
    expect(requireSession).not.toHaveBeenCalled();
    expect(setOrderPrimaryContact).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('setOrderPrimaryContactAction — сервис и перечитывание', () => {
  it('назначение: сессия, свежий teamMode и форма уходят сервису; перечитываются заказ и контакт в трёх кабинетах', async () => {
    expect(await setOrderPrimaryContactAction({ orderId: 'ord-1', contactId: 'k1' })).toEqual({
      ok: true,
    });
    expect(getCompanyTeamVisibility).toHaveBeenCalledWith({}, 'c1');
    expect(setOrderPrimaryContact).toHaveBeenCalledWith({}, session, true, {
      orderId: 'ord-1',
      contactId: 'k1',
    });
    for (const c of cabinets) {
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/orders/ord-1`);
      expect(revalidatePath).toHaveBeenCalledWith(`/${c}/contacts/k1`);
    }
    expect(revalidatePath).toHaveBeenCalledTimes(6);
  });

  it('снятие (null): teamMode false из базы уходит как есть; карточка контакта не перечитывается', async () => {
    getCompanyTeamVisibility.mockResolvedValue(false);
    expect(await setOrderPrimaryContactAction({ orderId: 'ord-1', contactId: null })).toEqual({
      ok: true,
    });
    expect(setOrderPrimaryContact).toHaveBeenCalledWith({}, session, false, {
      orderId: 'ord-1',
      contactId: null,
    });
    for (const c of cabinets) expect(revalidatePath).toHaveBeenCalledWith(`/${c}/orders/ord-1`);
    expect(revalidatePath).toHaveBeenCalledTimes(3);
    expect(revalidatePath).not.toHaveBeenCalledWith(expect.stringContaining('/contacts/'));
  });

  it('отказ сервиса возвращается как есть и ничего не перечитывает', async () => {
    for (const error of ['forbidden', 'not_found', 'contact_not_found'] as const) {
      setOrderPrimaryContact.mockResolvedValueOnce({ ok: false, error });
      expect(await setOrderPrimaryContactAction({ orderId: 'ord-1', contactId: 'k1' })).toEqual({
        ok: false,
        error,
      });
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
