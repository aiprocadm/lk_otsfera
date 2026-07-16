import { it, expect, vi, beforeEach } from 'vitest';

import {
  ensureGeneral,
  openDm,
  listConversations,
  staffUnreadCount,
  markStaffRead,
  dmKeyFor
} from '@/lib/services/staffChat/conversations';

const manager = { sub: 'm1', role: 'manager', companyId: 'c1' } as never;
const admin = { sub: 'a1', role: 'admin', companyId: null } as never;
const partner = { sub: 'p1', role: 'partner', companyId: 'c1' } as never;

beforeEach(() => vi.clearAllMocks());

it('dmKeyFor is order-independent', () => {
  expect(dmKeyFor('u2', 'u1')).toBe('u1:u2');
  expect(dmKeyFor('u1', 'u2')).toBe('u1:u2');
});

it('ensureGeneral creates lazily and recovers from P2002 race', async () => {
  const create = vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
  const findFirst = vi.fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ id: 'g1' });
  const prisma = { staffConversation: { create, findFirst } } as never;
  const res = await ensureGeneral(prisma, 'c1');
  expect(res).toEqual({ ok: true, conversationId: 'g1' });
});

it('openDm: cross-company target → forbidden; non-staff caller → forbidden', async () => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'u9', role: 'manager', companyId: 'c2', isActive: true, name: 'X' }) },
    staffConversation: { create: vi.fn(), findUnique: vi.fn() }
  } as never;
  expect(await openDm(prisma, manager, { targetUserId: 'u9' })).toEqual({ ok: false, error: 'forbidden' });
  expect(await openDm({} as never, partner, { targetUserId: 'm1' })).toEqual({ ok: false, error: 'forbidden' });
});

it('openDm is idempotent by dmKey (P2002 → findUnique)', async () => {
  const target = { id: 'm2', role: 'manager', companyId: 'c1', isActive: true, name: 'Пётр' };
  const create = vi.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
  const findUnique = vi.fn().mockResolvedValue({ id: 'dm1' });
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique }
  } as never;
  const res = await openDm(prisma, manager, { targetUserId: 'm2' });
  expect(res).toEqual({ ok: true, conversationId: 'dm1' });
  expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { dmKey: 'm1:m2' } }));
});

it('staffUnreadCount: считает беседы с lastMessageAt > lastReadAt', async () => {
  const findMany = vi.fn().mockResolvedValue([
    { id: 'g1', lastMessageAt: new Date('2026-07-17T10:00:00Z'), readStates: [] },
    { id: 'd1', lastMessageAt: new Date('2026-07-17T09:00:00Z'), readStates: [{ lastReadAt: new Date('2026-07-17T09:30:00Z') }] }
  ]);
  const prisma = { staffConversation: { findMany } } as never;
  const res = await staffUnreadCount(prisma, manager);
  expect(res).toEqual({ ok: true, count: 1 });
});

it('client role gets empty list / zero count / markRead forbidden', async () => {
  expect(await listConversations({} as never, partner)).toEqual({ ok: true, rows: [] });
  expect(await staffUnreadCount({} as never, partner)).toEqual({ ok: true, count: 0 });
  expect(await markStaffRead({} as never, partner, { conversationId: 'x' })).toEqual({ ok: false, error: 'forbidden' });
});

// --- extended coverage: ensureGeneral branches ---

it('ensureGeneral: fast path returns existing conversation without creating', async () => {
  const findFirst = vi.fn().mockResolvedValue({ id: 'g0' });
  const create = vi.fn();
  const prisma = { staffConversation: { create, findFirst } } as never;
  const res = await ensureGeneral(prisma, 'c1');
  expect(res).toEqual({ ok: true, conversationId: 'g0' });
  expect(create).not.toHaveBeenCalled();
});

it('ensureGeneral: creates when none exists (no race)', async () => {
  const findFirst = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({ id: 'g2' });
  const prisma = { staffConversation: { create, findFirst } } as never;
  const res = await ensureGeneral(prisma, 'c1');
  expect(res).toEqual({ ok: true, conversationId: 'g2' });
});

it('ensureGeneral: race then still not found → storage error', async () => {
  const create = vi.fn().mockRejectedValue(new Error('boom'));
  const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
  const prisma = { staffConversation: { create, findFirst } } as never;
  const res = await ensureGeneral(prisma, 'c1');
  expect(res).toEqual({ ok: false, error: 'storage' });
});

// --- extended coverage: openDm branches ---

it('openDm: self-dm is forbidden', async () => {
  expect(await openDm({} as never, manager, { targetUserId: 'm1' })).toEqual({ ok: false, error: 'forbidden' });
});

it('openDm: target not found → target_not_found', async () => {
  const prisma = { user: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
  expect(await openDm(prisma, manager, { targetUserId: 'ghost' })).toEqual({ ok: false, error: 'target_not_found' });
});

it('openDm: inactive target → target_not_found', async () => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'm9', role: 'manager', companyId: 'c1', isActive: false }) }
  } as never;
  expect(await openDm(prisma, manager, { targetUserId: 'm9' })).toEqual({ ok: false, error: 'target_not_found' });
});

it('openDm: non-staff target → forbidden', async () => {
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'p1', role: 'partner', companyId: 'c1', isActive: true }) }
  } as never;
  expect(await openDm(prisma, manager, { targetUserId: 'p1' })).toEqual({ ok: false, error: 'forbidden' });
});

it('openDm: creates a new DM when none exists (happy path, no race)', async () => {
  const target = { id: 'm3', role: 'manager', companyId: 'c1', isActive: true };
  const create = vi.fn().mockResolvedValue({ id: 'dmNew' });
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique: vi.fn() }
  } as never;
  const res = await openDm(prisma, manager, { targetUserId: 'm3' });
  expect(res).toEqual({ ok: true, conversationId: 'dmNew' });
});

it('openDm: admin → manager DM derives companyId from target', async () => {
  const target = { id: 'm5', role: 'manager', companyId: 'c9', isActive: true };
  const create = vi.fn().mockResolvedValue({ id: 'dmAdmin' });
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique: vi.fn() }
  } as never;
  const res = await openDm(prisma, admin, { targetUserId: 'm5' });
  expect(res).toEqual({ ok: true, conversationId: 'dmAdmin' });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: 'c9' }) }));
});

it('openDm: manager → admin DM derives companyId from session', async () => {
  const target = { id: 'a2', role: 'admin', companyId: null, isActive: true };
  const create = vi.fn().mockResolvedValue({ id: 'dmToAdmin' });
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique: vi.fn() }
  } as never;
  const res = await openDm(prisma, manager, { targetUserId: 'a2' });
  expect(res).toEqual({ ok: true, conversationId: 'dmToAdmin' });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: 'c1' }) }));
});

it('openDm: both sides companyless → forbidden (nowhere to attach DM)', async () => {
  const target = { id: 'm7', role: 'manager', companyId: null, isActive: true };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create: vi.fn(), findUnique: vi.fn() }
  } as never;
  const res = await openDm(prisma, admin, { targetUserId: 'm7' });
  expect(res).toEqual({ ok: false, error: 'forbidden' });
});

it('openDm: create races and dmKey lookup also empty → forbidden', async () => {
  const target = { id: 'm4', role: 'manager', companyId: 'c1', isActive: true };
  const create = vi.fn().mockRejectedValue(new Error('boom'));
  const findUnique = vi.fn().mockResolvedValue(null);
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue(target) },
    staffConversation: { create, findUnique }
  } as never;
  const res = await openDm(prisma, manager, { targetUserId: 'm4' });
  expect(res).toEqual({ ok: false, error: 'forbidden' });
});

// --- extended coverage: listConversations branches ---

it('listConversations: manager without companyId skips ensureGeneral and scopes via sentinel', async () => {
  const findFirst = vi.fn();
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { staffConversation: { findFirst, findMany, create: vi.fn() } } as never;
  const mgrNoCompany = { sub: 'm9', role: 'manager', companyId: null } as never;
  const res = await listConversations(prisma, mgrNoCompany);
  expect(res).toEqual({ ok: true, rows: [] });
  expect(findFirst).not.toHaveBeenCalled();
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ companyId: '__no_company__' }) })
  );
});

it('listConversations: manager with companyId triggers ensureGeneral and scopes by company', async () => {
  const findFirst = vi.fn().mockResolvedValue({ id: 'g1' });
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { staffConversation: { findFirst, findMany, create: vi.fn() } } as never;
  const res = await listConversations(prisma, manager);
  expect(res).toEqual({ ok: true, rows: [] });
  expect(findFirst).toHaveBeenCalled();
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { companyId: 'c1', OR: [{ kind: 'general' }, { participants: { some: { userId: 'm1' } } }] }
    })
  );
});

it('listConversations: admin sees general (all companies) + own dm, mapped correctly', async () => {
  const findMany = vi.fn().mockResolvedValue([
    {
      id: 'g1',
      kind: 'general',
      lastMessageAt: new Date('2026-07-17T10:00:00Z'),
      company: { name: 'ООО Ромашка' },
      participants: [],
      readStates: []
    },
    {
      id: 'd1',
      kind: 'dm',
      lastMessageAt: new Date('2026-07-17T08:00:00Z'),
      company: { name: 'ООО Ромашка' },
      participants: [
        { userId: 'a1', user: { name: 'Админ' } },
        { userId: 'm1', user: { name: 'Пётр' } }
      ],
      readStates: [{ lastReadAt: new Date('2026-07-17T09:00:00Z') }]
    },
    {
      id: 'd2',
      kind: 'dm',
      lastMessageAt: new Date('2026-07-17T07:00:00Z'),
      company: { name: 'ООО Ромашка' },
      participants: [{ userId: 'a1', user: { name: 'Админ' } }],
      readStates: []
    }
  ]);
  const prisma = { staffConversation: { findMany } } as never;
  const res = await listConversations(prisma, admin);
  expect(res).toEqual({
    ok: true,
    rows: [
      { id: 'g1', kind: 'general', title: '# Общий', companyName: 'ООО Ромашка', lastMessageAt: new Date('2026-07-17T10:00:00Z'), unread: true },
      { id: 'd1', kind: 'dm', title: 'Пётр', companyName: null, lastMessageAt: new Date('2026-07-17T08:00:00Z'), unread: false },
      { id: 'd2', kind: 'dm', title: 'Диалог', companyName: null, lastMessageAt: new Date('2026-07-17T07:00:00Z'), unread: true }
    ]
  });
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { OR: [{ kind: 'general' }, { participants: { some: { userId: 'a1' } } }] } })
  );
});

// --- extended coverage: staffUnreadCount branches ---

it('staffUnreadCount: admin where-branch counts unread across all-company generals + own dm', async () => {
  const findMany = vi.fn().mockResolvedValue([{ lastMessageAt: new Date('2026-07-17T10:00:00Z'), readStates: [] }]);
  const prisma = { staffConversation: { findMany } } as never;
  const res = await staffUnreadCount(prisma, admin);
  expect(res).toEqual({ ok: true, count: 1 });
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { OR: [{ kind: 'general' }, { participants: { some: { userId: 'a1' } } }] } })
  );
});

it('staffUnreadCount: manager without companyId uses sentinel', async () => {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { staffConversation: { findMany } } as never;
  const mgrNoCompany = { sub: 'm9', role: 'manager', companyId: null } as never;
  const res = await staffUnreadCount(prisma, mgrNoCompany);
  expect(res).toEqual({ ok: true, count: 0 });
  expect(findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: expect.objectContaining({ companyId: '__no_company__' }) })
  );
});

// --- extended coverage: markStaffRead branches ---

it('markStaffRead: conversation not found', async () => {
  const prisma = { staffConversation: { findUnique: vi.fn().mockResolvedValue(null) } } as never;
  expect(await markStaffRead(prisma, manager, { conversationId: 'ghost' })).toEqual({
    ok: false,
    error: 'conversation_not_found'
  });
});

it('markStaffRead: found but not visible → forbidden', async () => {
  const conv = { id: 'g2', kind: 'general', companyId: 'c2', participants: [] };
  const prisma = { staffConversation: { findUnique: vi.fn().mockResolvedValue(conv) } } as never;
  expect(await markStaffRead(prisma, manager, { conversationId: 'g2' })).toEqual({ ok: false, error: 'forbidden' });
});

it('markStaffRead: visible conversation → upserts read state', async () => {
  const conv = { id: 'g1', kind: 'general', companyId: 'c1', participants: [] };
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = {
    staffConversation: { findUnique: vi.fn().mockResolvedValue(conv) },
    staffMessageRead: { upsert }
  } as never;
  const res = await markStaffRead(prisma, manager, { conversationId: 'g1' });
  expect(res).toEqual({ ok: true });
  expect(upsert).toHaveBeenCalledWith(
    expect.objectContaining({ where: { conversationId_userId: { conversationId: 'g1', userId: 'm1' } } })
  );
});
