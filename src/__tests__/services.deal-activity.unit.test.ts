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
    ]) },
    call: { findMany: vi.fn().mockResolvedValue([
      { id: 'ca1', direction: 'inbound', callerNumber: '+70000000000', durationSec: 10,
        startedAt: new Date(), createdAt: new Date(), recordingScanStatus: 'clean',
        recordingPath: 'x', initiatedBy: null }
    ]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([
      { id: 'e1', createdAt: new Date() }
    ]) }
  });
  // Sanity: view:'all' surfaces note+call+event, so their absence below is real exclusion.
  const all = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(all.ok && all.items.map((i) => i.kind).sort()).toEqual(['call', 'event', 'note']);
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

it('handles an order with no threads (skips thread-scoped queries)', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const message = { findMany: vi.fn() };
  const inboundMessage = { findMany: vi.fn() };
  const call = { findMany: vi.fn() };
  const prisma = fakePrisma({
    orderThread: { findMany: vi.fn().mockResolvedValue([]) },
    message, inboundMessage, call,
    comment: { findMany: vi.fn().mockResolvedValue([
      { id: 'cm1', body: 'привет', createdAt: new Date('2026-07-13T08:00:00Z'), author: { name: 'Клиент' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.items.map((i) => i.kind)).toEqual(['comment']);
  // thread-scoped queries must NOT run when there are no threads
  expect(message.findMany).not.toHaveBeenCalled();
  expect(inboundMessage.findMany).not.toHaveBeenCalled();
  expect(call.findMany).not.toHaveBeenCalled();
});

it('maps outgoing messages with hasAttachment flag and status-change events', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    message: { findMany: vi.fn().mockResolvedValue([
      { id: 'm1', body: 'без файла', createdAt: new Date('2026-07-13T06:00:00Z'),
        attachmentPath: null, author: { name: 'Менеджер' } },
      { id: 'm2', body: 'с файлом', createdAt: new Date('2026-07-13T06:30:00Z'),
        attachmentPath: 'orders/o1/doc.pdf', author: { name: 'Менеджер' } }
    ]) },
    auditLog: { findMany: vi.fn().mockResolvedValue([
      { id: 'e1', createdAt: new Date('2026-07-13T07:00:00Z') }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const m1 = res.items.find((i) => i.id === 'm1');
  const m2 = res.items.find((i) => i.id === 'm2');
  expect(m1).toMatchObject({ kind: 'message_out', hasAttachment: false, body: 'без файла' });
  expect(m2).toMatchObject({ kind: 'message_out', hasAttachment: true, body: 'с файлом' });
  const event = res.items.find((i) => i.kind === 'event');
  expect(event).toMatchObject({ id: 'e1', label: 'Смена статуса заказа' });
});

it('maps a call with no startedAt, unscanned recording, and a known initiator', async () => {
  getOrder.mockResolvedValue({ id: 'o1' });
  const prisma = fakePrisma({
    call: { findMany: vi.fn().mockResolvedValue([
      { id: 'ca2', direction: 'outbound', callerNumber: '+79990000000', durationSec: null,
        startedAt: null, createdAt: new Date('2026-07-13T07:00:00Z'), recordingScanStatus: 'pending',
        recordingPath: null, initiatedBy: { name: 'Менеджер' } }
    ]) }
  });
  const res = await getDealActivity(prisma, session, 'o1', { view: 'all' });
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const call = res.items.find((i) => i.kind === 'call');
  expect(call).toMatchObject({
    at: new Date('2026-07-13T07:00:00Z'), // startedAt null → falls back to createdAt
    recordingReady: false, // scanStatus !== 'clean' short-circuits
    initiator: 'Менеджер' // initiatedBy present → name, not null fallback
  });
});
