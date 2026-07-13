import { it, expect, vi, beforeEach } from 'vitest';

const { requireManager, addDealNote, initiateOutboundCall, notFoundIfDisabled } = vi.hoisted(() => ({
  requireManager: vi.fn(), addDealNote: vi.fn(), initiateOutboundCall: vi.fn(), notFoundIfDisabled: vi.fn()
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/dealNotes', () => ({ addDealNote }));
vi.mock('@/lib/services/telephony/initiateCall', () => ({ initiateOutboundCall }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

import { addDealNoteAction, initiateCallAction } from '@/server-actions/deal-activity';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' };
beforeEach(() => { vi.clearAllMocks(); requireManager.mockResolvedValue(session); });

it('addDealNoteAction requires manager and delegates', async () => {
  addDealNote.mockResolvedValue({ ok: true, id: 'n1' });
  const res = await addDealNoteAction({ orderId: 'o1', body: 'hi' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(addDealNote).toHaveBeenCalledWith({}, session, { orderId: 'o1', body: 'hi' });
  expect(res).toEqual({ ok: true, id: 'n1' });
});

it('initiateCallAction returns disabled when telephony flag off (no manager check needed)', async () => {
  notFoundIfDisabled.mockReturnValue(new Response(null, { status: 404 }));
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(res).toEqual({ ok: false, error: 'disabled' });
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});

it('initiateCallAction delegates when enabled', async () => {
  notFoundIfDisabled.mockReturnValue(null);
  initiateOutboundCall.mockResolvedValue({ ok: true, callId: 'ca1' });
  const res = await initiateCallAction({ orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(initiateOutboundCall).toHaveBeenCalledWith({}, session, { orderId: 'o1', toNumber: '+70000000000', fromInternal: '101' });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
});
