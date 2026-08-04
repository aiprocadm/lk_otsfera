/**
 * Unit-тесты сервиса `updateInternalPhone` (src/lib/services/staff/profile.ts):
 * trim без канонизации телефона, очистка пустой строкой, граница длины и запись
 * ТОЛЬКО в собственный профиль вызывающего.
 */
import { it, expect, vi, beforeEach } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { update } } }));

import { prisma } from '@/lib/db/prisma';
import { updateInternalPhone } from '@/lib/services/staff/profile';

const session: SessionPayload = { sub: 'u1', role: 'manager', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

it('stores a trimmed internal number for the authenticated manager', async () => {
  const res = await updateInternalPhone(prisma, session, { internalPhone: '  101  ' });
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: '101' } });
  expect(res).toEqual({ ok: true });
});

it('an empty (or whitespace-only) value clears the number to null', async () => {
  const res = await updateInternalPhone(prisma, session, { internalPhone: '   ' });
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: null } });
  expect(res).toEqual({ ok: true });
});

it('rejects an absurdly long value (>32 chars) as invalid without touching the DB', async () => {
  const res = await updateInternalPhone(prisma, session, { internalPhone: 'x'.repeat(33) });
  expect(res).toEqual({ ok: false, error: 'invalid' });
  expect(update).not.toHaveBeenCalled();
});

it('accepts a value exactly at the 32-char boundary', async () => {
  const value = 'x'.repeat(32);
  const res = await updateInternalPhone(prisma, session, { internalPhone: value });
  expect(update).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { internalPhone: value } });
  expect(res).toEqual({ ok: true });
});
