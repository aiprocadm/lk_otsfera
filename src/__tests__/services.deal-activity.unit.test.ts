import { it, expect, vi, beforeEach } from 'vitest';

const { getOrder, recordPiiAccessMany } = vi.hoisted(() => ({
  getOrder: vi.fn(),
  recordPiiAccessMany: vi.fn()
}));
vi.mock('@/lib/services/manager/orders', () => ({ getOrder }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccessMany, recordPiiAccess: vi.fn() }));

import { getDealActivity } from '@/lib/services/manager/dealActivity';

const session = { sub: 'u1', role: 'manager', companyId: 'c1' } as never;

function fakePrisma(over: Record<string, unknown> = {}) {
  const base = {
    orderThread: { findMany: vi.fn().mockResolvedValue([{ id: 't1' }]) },
    comment: { findMany: vi.fn().mockResolvedValue([]) },
    message: { findMany: vi.fn().mockResolvedValue([]) },
    inboundMessage: { findMany: vi.fn().mockResolvedValue([]) },
    call: { findMany: vi.fn().mockResolvedValue([]) },
    dealNote: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([]) }
  };
  return { ...base, ...over } as never;
}

beforeEach(() => vi.clearAllMocks());

it('returns not_found when order is not visible', async () => {
  getOrder.mockResolvedValue(null);
  const res = await getDealActivity(fakePrisma(), session, 'o1', { view: 'all' });
  expect(res).toEqual({ ok: false, error: 'not_found' });
});

it('merges sources ascending by unified `at`, using inbound.sentAt over createdAt', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    inboundMessage: { findMany: vi.fn().mockResolvedValue([
      { id: 'in1', channel: 'whatsapp', senderDisplay: 'Пётр', senderRef: 'wa:1', body: 'привет',
        sentAt: new Date('2026-07-13T10:00:00Z'), createdAt: new Date('2026-07-13T10:05:00Z'),
        attachmentName: null }
    ]) },
    dealNote: { findMany: vi.fn().mockResolvedValue([
      { id: 'n1', body: 'скидка 5%', createdAt: new Date('2026-07-13T09:00:00Z'),
        author: { name: 'Иванов' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.items.map((i) => i.kind)).toEqual(['note', 'message_in']); // 09:00 before 10:00
  expect(res.items[1].at).toEqual(new Date('2026-07-13T10:00:00Z')); // sentAt wins
});

it("view:'dialogue' excludes note/call/event", async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    dealNote: { findMany: vi.fn().mockResolvedValue([
      { id: 'n1', body: 'x', createdAt: new Date(), author: { name: 'И' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'dialogue' });
  expect(res.ok && res.items.length).toBe(0);
});

it('records PII access for inbound + calls (two contexts)', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    inboundMessage: { findMany: vi.fn().mockResolvedValue([
      { id: 'in1', channel: 'email', senderDisplay: null, senderRef: 'a@b.c', body: 'hi', sentAt: null,
        createdAt: new Date(), attachmentName: null }
    ]) },
    call: { findMany: vi.fn().mockResolvedValue([
      { id: 'ca1', direction: 'inbound', callerNumber: '+70000000000', durationSec: 10,
        startedAt: new Date(), createdAt: new Date(), recordingScanStatus: 'clean',
        recordingPath: 'x', initiatedBy: null }
    ]) }
  });
  await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(recordPiiAccessMany).toHaveBeenCalledOnce();
  const argsList = recordPiiAccessMany.mock.calls[0][1];
  expect(argsList.map((a: { context: string }) => a.context).sort())
    .toEqual(['deal_activity_calls', 'deal_activity_inbound']);
});
