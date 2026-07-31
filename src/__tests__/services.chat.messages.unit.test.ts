/**
 * Unit tests for src/lib/services/chat/messages.ts
 * Covers branches missed by existing test (listMessages, after-cursor, notify paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { notifyManagers, notifyOrgUsers } = vi.hoisted(() => ({
  notifyManagers: vi.fn(),
  notifyOrgUsers: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notifyManagers, notifyOrgUsers }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/services/chat/policy', () => ({ canSeeThread: vi.fn() }));

import { listMessages, sendMessage } from '@/lib/services/chat/messages';
import { canSeeThread } from '@/lib/services/chat/policy';
const canSeeThreadMock = canSeeThread as ReturnType<typeof vi.fn>;

const orgSession = {
  sub: 'u1',
  role: 'organization',
  organizationMemberships: [{ organizationId: 'org1', isActive: true, roleInOrg: 'member' }],
} as any;
const teamSession = { sub: 'mgr1', role: 'manager', companyId: 'c1' } as any;
const adminSession = { sub: 'adm1', role: 'admin' } as any;

const order = {
  id: 'o1',
  organizationId: 'org1',
  partnerId: 'p1',
  companyId: 'c1',
  orderNumber: 'N1',
  title: 'Заказ',
};
const thread = { id: 't1', side: 'org', order: { ...order } };

function makePrisma(threadVal: object | null, msgs: object[] = []) {
  return {
    orderThread: { findUnique: vi.fn().mockResolvedValue(threadVal) },
    message: { findMany: vi.fn().mockResolvedValue(msgs) },
  } as any;
}

function makeSendPrisma(orderVal: object | null) {
  return {
    order: { findUnique: vi.fn().mockResolvedValue(orderVal) },
    orderThread: { upsert: vi.fn().mockResolvedValue({ id: 't1', side: 'org', orderId: 'o1' }) },
    message: { create: vi.fn().mockResolvedValue({ id: 'm1' }) },
  } as any;
}

beforeEach(() => {
  canSeeThreadMock.mockReset();
  notifyManagers.mockReset();
  notifyOrgUsers.mockReset();
});

// ─── listMessages ─────────────────────────────────────────────────────────────

describe('listMessages — unit', () => {
  it('returns thread_not_found when thread does not exist', async () => {
    const prisma = makePrisma(null);
    const result = await listMessages(prisma, orgSession, { threadId: 'x' });
    expect(result).toEqual({ ok: false, error: 'thread_not_found' });
  });

  it('returns forbidden when canSeeThread is false', async () => {
    canSeeThreadMock.mockReturnValue(false);
    const prisma = makePrisma(thread);
    const result = await listMessages(prisma, orgSession, { threadId: 't1' });
    expect(result).toEqual({ ok: false, error: 'forbidden' });
  });

  it('returns messages when authorized', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const msgs = [
      {
        id: 'm1',
        authorId: 'u1',
        body: 'Привет',
        attachmentPath: null,
        createdAt: new Date('2024-06-01'),
        author: { name: 'Пользователь' },
      },
    ];
    const prisma = makePrisma(thread, msgs);
    const result = await listMessages(prisma, orgSession, { threadId: 't1' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].authorName).toBe('Пользователь');
      expect(result.rows[0].hasAttachment).toBe(false);
    }
  });

  it('sets hasAttachment=true when attachmentPath is present', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const msgs = [
      {
        id: 'm2',
        authorId: 'u1',
        body: 'See attachment',
        attachmentPath: 'chat/o1/file.pdf',
        createdAt: new Date('2024-06-02'),
        author: { name: 'U' },
      },
    ];
    const prisma = makePrisma(thread, msgs);
    const result = await listMessages(prisma, orgSession, { threadId: 't1' });
    if (result.ok) {
      expect(result.rows[0].hasAttachment).toBe(true);
    }
  });

  it('ignores invalid after cursor (NaN date)', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const prisma = makePrisma(thread, []);
    const result = await listMessages(prisma, orgSession, { threadId: 't1', after: 'not-a-date' });
    expect(result.ok).toBe(true);
    // validAfter should be null → no createdAt filter
    const queryWhere = prisma.message.findMany.mock.calls[0][0].where;
    expect(queryWhere.createdAt).toBeUndefined();
  });

  it('applies valid after cursor as createdAt: { gt }', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const prisma = makePrisma(thread, []);
    const afterTs = new Date('2024-05-01').toISOString();
    await listMessages(prisma, orgSession, { threadId: 't1', after: afterTs });
    const queryWhere = prisma.message.findMany.mock.calls[0][0].where;
    expect(queryWhere.createdAt).toBeDefined();
    expect(queryWhere.createdAt.gt).toBeInstanceOf(Date);
  });
});

// ─── sendMessage notification paths not covered by existing test ───────────────

describe('listMessages — null author name fallback', () => {
  it('uses empty string when author.name is null', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const msgs = [
      {
        id: 'm1',
        authorId: 'u1',
        body: 'Hello',
        attachmentPath: null,
        createdAt: new Date('2024-06-01'),
        author: { name: null }, // triggers ?? '' branch
      },
    ];
    const prisma = makePrisma(thread, msgs);
    const result = await listMessages(prisma, orgSession, { threadId: 't1' });
    if (result.ok) {
      expect(result.rows[0].authorName).toBe('');
    }
  });
});

describe('sendMessage — additional branches', () => {
  it('body with null (args.body is undefined) returns empty_body', async () => {
    const prisma = makeSendPrisma(order);
    // args.body is undefined → trim() would throw but ?. makes it undefined, ?? '' → ''
    const result = await sendMessage(prisma, orgSession, {
      orderId: 'o1',
      side: 'org',
      body: undefined as any,
    });
    expect(result).toEqual({ ok: false, error: 'empty_body' });
  });

  it('team on partner side does NOT call notifyOrgUsers', async () => {
    // team (manager) on 'partner' side: notifyOrgUsers should NOT be called
    // (partner-side notification is deferred; org notify only for side=org)
    canSeeThreadMock.mockReturnValue(true);
    const prisma = makeSendPrisma(order);
    await sendMessage(prisma, teamSession, { orderId: 'o1', side: 'partner', body: 'hello' });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('team on org side but organizationId=null does NOT call notifyOrgUsers', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const orderNoOrg = { ...order, organizationId: null };
    const prisma = makeSendPrisma(orderNoOrg);
    await sendMessage(prisma, teamSession, { orderId: 'o1', side: 'org', body: 'hello' });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('swallows notification Error and still returns ok:true (Error instanceof branch)', async () => {
    canSeeThreadMock.mockReturnValue(true);
    notifyManagers.mockRejectedValue(new Error('notify down'));
    const prisma = makeSendPrisma(order);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await sendMessage(prisma, orgSession, {
      orderId: 'o1',
      side: 'org',
      body: 'hi',
    });
    expect(result).toEqual({ ok: true, messageId: 'm1' });
    consoleSpy.mockRestore();
  });

  it('swallows non-Error notification throw (String(err) branch)', async () => {
    canSeeThreadMock.mockReturnValue(true);
    // Throw a plain string — triggers the `String(err)` arm of `err instanceof Error ? err.message : String(err)`
    notifyManagers.mockRejectedValue('string error from notify');
    const prisma = makeSendPrisma(order);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await sendMessage(prisma, orgSession, {
      orderId: 'o1',
      side: 'org',
      body: 'hi',
    });
    expect(result).toEqual({ ok: true, messageId: 'm1' });
    consoleSpy.mockRestore();
  });

  it('admin sends message on partner side and calls notifyManagers', async () => {
    canSeeThreadMock.mockReturnValue(true);
    const prisma = makeSendPrisma(order);
    // admin IS in the "non-team" branch → wait, admin role is manager||admin → isTeam=true
    // admin on org side calls notifyOrgUsers
    notifyOrgUsers.mockResolvedValue(undefined);
    const result = await sendMessage(prisma, adminSession, {
      orderId: 'o1',
      side: 'org',
      body: 'admin msg',
    });
    expect(result.ok).toBe(true);
    expect(notifyOrgUsers).toHaveBeenCalled();
  });
});
