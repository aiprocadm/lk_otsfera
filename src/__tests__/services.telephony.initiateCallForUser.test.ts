/**
 * Unit-тесты сервиса `initiateCallForUser`
 * (src/lib/services/telephony/initiateCallForUser.ts): «плечо А» берётся из
 * профиля вызывающего, без добавочного звонок не инициируется.
 */
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionPayload } from '@/lib/auth/jwt';

const { initiateOutboundCall, findUnique } = vi.hoisted(() => ({
  initiateOutboundCall: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique } } }));
vi.mock('@/lib/services/telephony/initiateCall', () => ({ initiateOutboundCall }));

import { prisma } from '@/lib/db/prisma';
import { initiateCallForUser } from '@/lib/services/telephony/initiateCallForUser';

const session: SessionPayload = { sub: 'u1', role: 'manager', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
});

it("derives fromInternal from the caller's User.internalPhone and delegates", async () => {
  findUnique.mockResolvedValue({ internalPhone: '101' });
  initiateOutboundCall.mockResolvedValue({ ok: true, callId: 'ca1' });

  const res = await initiateCallForUser(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
  });

  expect(findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { internalPhone: true } });
  expect(initiateOutboundCall).toHaveBeenCalledWith(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
});

it('returns no_internal_phone when the caller has none set, without calling the transport', async () => {
  findUnique.mockResolvedValue({ internalPhone: null });
  const res = await initiateCallForUser(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
  });
  expect(res).toEqual({ ok: false, error: 'no_internal_phone' });
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});

it('returns no_internal_phone when the user record is missing entirely', async () => {
  findUnique.mockResolvedValue(null);
  const res = await initiateCallForUser(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
  });
  expect(res).toEqual({ ok: false, error: 'no_internal_phone' });
  expect(initiateOutboundCall).not.toHaveBeenCalled();
});
