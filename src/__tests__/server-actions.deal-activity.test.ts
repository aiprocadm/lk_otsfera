import { it, expect, vi, beforeEach } from 'vitest';

const { requireManager, addDealNote, initiateOutboundCall, notFoundIfDisabled, findUnique } =
  vi.hoisted(() => ({
    requireManager: vi.fn(),
    addDealNote: vi.fn(),
    initiateOutboundCall: vi.fn(),
    notFoundIfDisabled: vi.fn(),
    findUnique: vi.fn(),
  }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique } } }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/dealNotes', () => ({ addDealNote }));
vi.mock('@/lib/services/telephony/initiateCall', () => ({ initiateOutboundCall }));
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
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});

it("initiateCallAction derives fromInternal from the caller's User.internalPhone and delegates", async () => {
  notFoundIfDisabled.mockReturnValue(null);
  findUnique.mockResolvedValue({ internalPhone: '101' });
  initiateOutboundCall.mockResolvedValue({ ok: true, callId: 'ca1' });
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { internalPhone: true } });
  expect(initiateOutboundCall).toHaveBeenCalledWith(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
});

it('initiateCallAction returns no_internal_phone when the caller has none set, without calling the service', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  findUnique.mockResolvedValue({ internalPhone: null });
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' });
  expect(res).toEqual({ ok: false, error: 'no_internal_phone' });
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});

it('initiateCallAction returns no_internal_phone when the user record is missing entirely', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  findUnique.mockResolvedValue(null);
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000' });
  expect(res).toEqual({ ok: false, error: 'no_internal_phone' });
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});
