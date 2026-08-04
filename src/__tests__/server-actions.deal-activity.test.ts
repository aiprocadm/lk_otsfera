/**
 * Тонкий адаптер активности по сделке: флаг телефонии, гард роли и прокидка в
 * сервисы. Логика «плеча А» — в services.telephony.initiateCallForUser.test.ts.
 */
import { it, expect, vi, beforeEach } from 'vitest';

const { requireManager, addDealNote, initiateCallForUser, notFoundIfDisabled } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  addDealNote: vi.fn(),
  initiateCallForUser: vi.fn(),
  notFoundIfDisabled: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/dealNotes', () => ({ addDealNote }));
vi.mock('@/lib/services/telephony/initiateCallForUser', () => ({ initiateCallForUser }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import { prisma } from '@/lib/db/prisma';
import { addDealNoteAction, initiateCallAction } from '@/server-actions/deal-activity';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' };
beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue(session);
});

it('addDealNoteAction requires manager and delegates', async () => {
  addDealNote.mockResolvedValue({ ok: true, id: 'n1' });
  const res = await addDealNoteAction({ orderId: 'o1', body: 'hi' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(addDealNote).toHaveBeenCalledWith(prisma, session, { orderId: 'o1', body: 'hi' });
  expect(res).toEqual({ ok: true, id: 'n1' });
});

it('initiateCallAction returns disabled when telephony flag off (no manager check needed)', async () => {
  notFoundIfDisabled.mockReturnValue(new Response(null, { status: 404 }));
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' });
  expect(res).toEqual({ ok: false, error: 'disabled' });
  expect(requireManager).not.toHaveBeenCalled();
  expect(initiateCallForUser).not.toHaveBeenCalled();
});

it('initiateCallAction requires manager and delegates to the service', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  initiateCallForUser.mockResolvedValue({ ok: true, callId: 'ca1' });
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(initiateCallForUser).toHaveBeenCalledWith(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
  });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
});

it('initiateCallAction прокидывает коды отказа сервиса', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  for (const error of ['no_internal_phone', 'not_found', 'call_failed', 'disabled']) {
    initiateCallForUser.mockResolvedValue({ ok: false, error });
    expect(await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' })).toEqual({
      ok: false,
      error,
    });
  }
});
