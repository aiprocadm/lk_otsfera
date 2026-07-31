import { it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordAudit, writeSyncLog, isFeatureEnabled, initiateCallback } = vi.hoisted(
  () => ({
    getOrder: vi.fn(),
    recordAudit: vi.fn(),
    writeSyncLog: vi.fn(),
    isFeatureEnabled: vi.fn(),
    initiateCallback: vi.fn(),
  })
);
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));
vi.mock('@/lib/telephony/mango', () => ({ getMangoAdapter: () => ({ initiateCallback }) }));

import { initiateOutboundCall } from '@/lib/services/telephony/initiateCall';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;
beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
});

it('is disabled when telephony flag is off', async () => {
  isFeatureEnabled.mockReturnValue(false);
  const res = await initiateOutboundCall({} as never, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'disabled' });
});

it('returns not_found when order not visible', async () => {
  getOrder.mockResolvedValue(null);
  const res = await initiateOutboundCall({} as never, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('returns call_failed when the adapter throws', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockRejectedValue(new Error('mango down'));
  const res = await initiateOutboundCall({} as never, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'call_failed' });
});

it('creates outbound Call with initiator + audit + synclog', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockResolvedValue({ commandId: 'cmd9' });
  const create = vi.fn().mockResolvedValue({ id: 'ca1' });
  const findUnique = vi.fn().mockResolvedValue({ id: 'th1' });
  const prisma = { orderThread: { findUnique }, call: { create } } as never;
  const res = await initiateOutboundCall(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: true, callId: 'ca1' });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        direction: 'outbound',
        status: 'initiated',
        initiatedByUserId: 'u1',
        externalId: 'mango:cmd:cmd9',
      }),
    })
  );
  expect(recordAudit).toHaveBeenCalledOnce();
  expect(writeSyncLog).toHaveBeenCalledWith(
    expect.objectContaining({ entity: 'call', direction: 'outbound' })
  );
});

it('links to the org thread when one exists (threadId set) and tolerates none', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockResolvedValue({ commandId: 'cmdX' });
  const create = vi.fn().mockResolvedValue({ id: 'ca2' });
  const prisma = {
    orderThread: { findUnique: vi.fn().mockResolvedValue(null) },
    call: { create },
  } as never;
  const res = await initiateOutboundCall(prisma, session, {
    orderId: 'o1',
    toNumber: '+79000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: true, callId: 'ca2' });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ threadId: null }) })
  );
});

it('returns call_failed when persisting the Call throws (e.g. P2002 collision)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockResolvedValue({ commandId: 'cmdDup' });
  const create = vi
    .fn()
    .mockRejectedValue(new Error('Unique constraint failed on Call_provider_externalId'));
  const prisma = {
    orderThread: { findUnique: vi.fn().mockResolvedValue(null) },
    call: { create },
  } as never;
  const res = await initiateOutboundCall(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'call_failed' });
});

it('maps a non-Error adapter rejection to call_failed', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockRejectedValue('mango exploded'); // non-Error → exercises String(err)
  const res = await initiateOutboundCall({} as never, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'call_failed' });
});

it('maps a non-Error Call-persist rejection to call_failed (String(err) branch)', async () => {
  getOrder.mockResolvedValue({ id: 'o1', organizationId: 'org1', companyId: 'c1' });
  initiateCallback.mockResolvedValue({ commandId: 'cmdRaw' });
  const create = vi.fn().mockRejectedValue('db exploded'); // non-Error on the persist path
  const prisma = {
    orderThread: { findUnique: vi.fn().mockResolvedValue(null) },
    call: { create },
  } as never;
  const res = await initiateOutboundCall(prisma, session, {
    orderId: 'o1',
    toNumber: '+70000000000',
    fromInternal: '101',
  });
  expect(res).toEqual({ ok: false, error: 'call_failed' });
});
