import { it, expect, vi, beforeEach } from 'vitest';

const { requireManager, update } = vi.hoisted(() => ({ requireManager: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { update } } }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));

import { updateInternalPhoneAction } from '@/server-actions/staff-profile';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' };
beforeEach(() => { vi.clearAllMocks(); requireManager.mockResolvedValue(session); update.mockResolvedValue({}); });

it('stores a trimmed internal number for the authenticated manager', async () => {
  const res = await updateInternalPhoneAction({ internalPhone: '  101  ' });
  expect(requireManager).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: '101' } });
  expect(res).toEqual({ ok: true });
});

it('an empty (or whitespace-only) value clears the number to null', async () => {
  const res = await updateInternalPhoneAction({ internalPhone: '   ' });
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: null } });
  expect(res).toEqual({ ok: true });
});

it('rejects an absurdly long value (>32 chars) as invalid without touching the DB', async () => {
  const res = await updateInternalPhoneAction({ internalPhone: 'x'.repeat(33) });
  expect(res).toEqual({ ok: false, error: 'invalid' });
  expect(update).not.toHaveBeenCalled();
});

it('accepts a value exactly at the 32-char boundary', async () => {
  const value = 'x'.repeat(32);
  const res = await updateInternalPhoneAction({ internalPhone: value });
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: value } });
  expect(res).toEqual({ ok: true });
});
