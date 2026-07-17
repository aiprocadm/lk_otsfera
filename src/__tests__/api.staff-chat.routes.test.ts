import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any module import that might
// transitively load the real implementations.
// ---------------------------------------------------------------------------
const {
  requireSessionMock,
  requireRoleMock,
  notFoundIfDisabledMock,
  listConversationsMock,
  openDmMock,
  staffUnreadCountMock,
  markStaffReadMock,
  sendStaffMessageMock,
  listStaffMessagesMock,
  toggleReactionMock,
  listColleaguesMock,
  uploadStaffAttachmentMock,
  getStaffAttachmentSignedUrlMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  requireRoleMock: vi.fn(),
  notFoundIfDisabledMock: vi.fn(),
  listConversationsMock: vi.fn(),
  openDmMock: vi.fn(),
  staffUnreadCountMock: vi.fn(),
  markStaffReadMock: vi.fn(),
  sendStaffMessageMock: vi.fn(),
  listStaffMessagesMock: vi.fn(),
  toggleReactionMock: vi.fn(),
  listColleaguesMock: vi.fn(),
  uploadStaffAttachmentMock: vi.fn(),
  getStaffAttachmentSignedUrlMock: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({
  requireSession: requireSessionMock,
  requireRole: requireRoleMock,
}));
vi.mock('@/lib/featureFlags', () => ({
  notFoundIfDisabled: notFoundIfDisabledMock,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/staffChat/conversations', () => ({
  listConversations: listConversationsMock,
  openDm: openDmMock,
  staffUnreadCount: staffUnreadCountMock,
  markStaffRead: markStaffReadMock,
}));
vi.mock('@/lib/services/staffChat/messages', () => ({
  sendStaffMessage: sendStaffMessageMock,
  listStaffMessages: listStaffMessagesMock,
  toggleReaction: toggleReactionMock,
}));
vi.mock('@/lib/services/staffChat/mentions', () => ({
  listColleagues: listColleaguesMock,
}));
vi.mock('@/lib/services/staffChat/attachments', () => ({
  uploadStaffAttachment: uploadStaffAttachmentMock,
  getStaffAttachmentSignedUrl: getStaffAttachmentSignedUrlMock,
}));

// ---------------------------------------------------------------------------
// Route imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { GET as conversationsGet } from '@/app/api/staff-chat/conversations/route';
import { GET as messagesGet, POST as messagesPost } from '@/app/api/staff-chat/messages/route';
import { POST as readPost } from '@/app/api/staff-chat/read/route';
import { POST as reactionsPost } from '@/app/api/staff-chat/reactions/route';
import { POST as dmPost } from '@/app/api/staff-chat/dm/route';
import { GET as colleaguesGet } from '@/app/api/staff-chat/colleagues/route';
import { GET as unreadGet } from '@/app/api/staff-chat/unread/route';
import { POST as attachmentPost, GET as attachmentGet } from '@/app/api/staff-chat/attachment/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function managerSession(overrides: Record<string, unknown> = {}) {
  return { sub: 'u-mgr-1', role: 'manager', companyId: 'co-1', ...overrides };
}

function unauthorizedResult() {
  return { ok: false as const, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) };
}

function forbiddenResult() {
  return { ok: false as const, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) };
}

function notFoundResponse() {
  return new Response('Not Found', { status: 404 });
}

function jsonReq(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function malformedJsonReq(url: string) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not-json',
  });
}

// Every (handler, args) pair, used for the blanket flag-off / auth sweeps below.
const allHandlers: Array<{ name: string; call: () => Promise<Response> }> = [
  { name: 'GET conversations', call: () => conversationsGet() },
  { name: 'GET messages', call: () => messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c1')) },
  { name: 'POST messages', call: () => messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: 'hi' })) },
  { name: 'POST read', call: () => readPost(jsonReq('https://app.local/api/staff-chat/read', { conversationId: 'c1' })) },
  { name: 'POST reactions', call: () => reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1', emoji: '👍' })) },
  { name: 'POST dm', call: () => dmPost(jsonReq('https://app.local/api/staff-chat/dm', { targetUserId: 'u2' })) },
  { name: 'GET colleagues', call: () => colleaguesGet() },
  { name: 'GET unread', call: () => unreadGet() },
  {
    name: 'POST attachment',
    call: () => {
      const fd = new FormData();
      fd.set('file', new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }));
      fd.set('conversationId', 'c1');
      return attachmentPost(new Request('https://app.local/api/staff-chat/attachment', { method: 'POST', body: fd }));
    },
  },
  { name: 'GET attachment', call: () => attachmentGet(new Request('https://app.local/api/staff-chat/attachment?messageId=m1')) },
];

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabledMock.mockReturnValue(null);
  requireSessionMock.mockResolvedValue({ ok: true, value: managerSession() });
  requireRoleMock.mockReturnValue({ ok: true, value: managerSession() });
});

// ---------------------------------------------------------------------------
// Blanket sweeps: flag-off (404) and unauthenticated (401) for every handler
// ---------------------------------------------------------------------------
describe('flag gate — every /api/staff-chat/* handler', () => {
  for (const h of allHandlers) {
    it(`${h.name}: flag OFF → 404`, async () => {
      notFoundIfDisabledMock.mockReturnValue(notFoundResponse());
      const res = await h.call();
      expect(res.status).toBe(404);
    });
  }
});

describe('auth gate — every /api/staff-chat/* handler', () => {
  for (const h of allHandlers) {
    it(`${h.name}: unauthenticated → 401`, async () => {
      requireSessionMock.mockResolvedValue(unauthorizedResult());
      const res = await h.call();
      expect(res.status).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/staff-chat/conversations
// ---------------------------------------------------------------------------
describe('GET /api/staff-chat/conversations', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await conversationsGet();
    expect(res.status).toBe(403);
    expect(listConversationsMock).not.toHaveBeenCalled();
  });

  it('happy path → 200 with rows', async () => {
    const rows = [{ id: 'c1', kind: 'general', title: '# Общий', companyName: 'Acme', lastMessageAt: new Date(), unread: false }];
    listConversationsMock.mockResolvedValue({ ok: true, rows });
    const res = await conversationsGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.rows).toHaveLength(1);
    expect(listConversationsMock).toHaveBeenCalledWith({}, managerSession());
  });
});

// ---------------------------------------------------------------------------
// GET /api/staff-chat/messages
// ---------------------------------------------------------------------------
describe('GET /api/staff-chat/messages', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c1'));
    expect(res.status).toBe(403);
    expect(listStaffMessagesMock).not.toHaveBeenCalled();
  });

  it('missing conversationId → 400', async () => {
    const res = await messagesGet(new Request('https://app.local/api/staff-chat/messages'));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(listStaffMessagesMock).not.toHaveBeenCalled();
  });

  it('happy path (no after) → 200 with rows', async () => {
    const rows = [{ id: 'm1', authorId: 'u1', authorName: 'A', body: 'hi', hasAttachment: false, attachmentName: null, scanStatus: 'none', createdAt: new Date(), reactions: [] }];
    listStaffMessagesMock.mockResolvedValue({ ok: true, rows });
    const res = await messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c1'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.rows).toHaveLength(1);
    expect(listStaffMessagesMock).toHaveBeenCalledWith({}, managerSession(), { conversationId: 'c1' });
  });

  it('passes after param when provided', async () => {
    listStaffMessagesMock.mockResolvedValue({ ok: true, rows: [] });
    await messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c1&after=2026-06-01T00:00:00.000Z'));
    expect(listStaffMessagesMock).toHaveBeenCalledWith({}, managerSession(), {
      conversationId: 'c1',
      after: '2026-06-01T00:00:00.000Z',
    });
  });

  it('service returns forbidden → 403', async () => {
    listStaffMessagesMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c1'));
    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'forbidden' });
  });

  it('service returns conversation_not_found → 404', async () => {
    listStaffMessagesMock.mockResolvedValue({ ok: false, error: 'conversation_not_found' });
    const res = await messagesGet(new Request('https://app.local/api/staff-chat/messages?conversationId=c-missing'));
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'conversation_not_found' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff-chat/messages
// ---------------------------------------------------------------------------
describe('POST /api/staff-chat/messages', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: 'hi' }));
    expect(res.status).toBe(403);
    expect(sendStaffMessageMock).not.toHaveBeenCalled();
  });

  it('malformed JSON body → 400', async () => {
    const res = await messagesPost(malformedJsonReq('https://app.local/api/staff-chat/messages'));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(sendStaffMessageMock).not.toHaveBeenCalled();
  });

  it('missing conversationId → 400', async () => {
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { body: 'hi' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(sendStaffMessageMock).not.toHaveBeenCalled();
  });

  it('missing body → 400', async () => {
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1' }));
    expect(res.status).toBe(400);
    expect(sendStaffMessageMock).not.toHaveBeenCalled();
  });

  it('happy path → 201 with messageId, service called with full args', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: true, messageId: 'msg-1' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/staff-chat/messages', {
        conversationId: 'c1',
        body: 'hello',
        attachmentPath: 'staff-chat/c1/uuid-file.pdf',
        attachmentName: 'file.pdf',
        attachmentMime: 'application/pdf',
      })
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; messageId: string };
    expect(json).toEqual({ ok: true, messageId: 'msg-1' });
    expect(sendStaffMessageMock).toHaveBeenCalledWith({}, managerSession(), {
      conversationId: 'c1',
      body: 'hello',
      attachmentPath: 'staff-chat/c1/uuid-file.pdf',
      attachmentName: 'file.pdf',
      attachmentMime: 'application/pdf',
    });
  });

  it('happy path without optional attachment fields → undefined passed through', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: true, messageId: 'msg-2' });
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: 'hello' }));
    expect(res.status).toBe(201);
    expect(sendStaffMessageMock).toHaveBeenCalledWith({}, managerSession(), {
      conversationId: 'c1',
      body: 'hello',
      attachmentPath: undefined,
      attachmentName: undefined,
      attachmentMime: undefined,
    });
  });

  it('service returns forbidden → 403', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: 'hi' }));
    expect(res.status).toBe(403);
  });

  it('service returns conversation_not_found → 404', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: false, error: 'conversation_not_found' });
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c-missing', body: 'hi' }));
    expect(res.status).toBe(404);
  });

  it('service returns too_large → 413', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: 'x'.repeat(5001) }));
    expect(res.status).toBe(413);
  });

  it('service returns empty_body → 400', async () => {
    sendStaffMessageMock.mockResolvedValue({ ok: false, error: 'empty_body' });
    const res = await messagesPost(jsonReq('https://app.local/api/staff-chat/messages', { conversationId: 'c1', body: '' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'empty_body' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff-chat/read
// ---------------------------------------------------------------------------
describe('POST /api/staff-chat/read', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await readPost(jsonReq('https://app.local/api/staff-chat/read', { conversationId: 'c1' }));
    expect(res.status).toBe(403);
    expect(markStaffReadMock).not.toHaveBeenCalled();
  });

  it('malformed JSON → 400', async () => {
    const res = await readPost(malformedJsonReq('https://app.local/api/staff-chat/read'));
    expect(res.status).toBe(400);
    expect(markStaffReadMock).not.toHaveBeenCalled();
  });

  it('missing conversationId → 400', async () => {
    const res = await readPost(jsonReq('https://app.local/api/staff-chat/read', {}));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(markStaffReadMock).not.toHaveBeenCalled();
  });

  it('happy path → 200 ok:true', async () => {
    markStaffReadMock.mockResolvedValue({ ok: true });
    const res = await readPost(jsonReq('https://app.local/api/staff-chat/read', { conversationId: 'c1' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json).toEqual({ ok: true });
    expect(markStaffReadMock).toHaveBeenCalledWith({}, managerSession(), { conversationId: 'c1' });
  });

  it('service returns forbidden → 403', async () => {
    markStaffReadMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await readPost(jsonReq('https://app.local/api/staff-chat/read', { conversationId: 'c1' }));
    expect(res.status).toBe(403);
  });

  it('service returns conversation_not_found → 404', async () => {
    markStaffReadMock.mockResolvedValue({ ok: false, error: 'conversation_not_found' });
    const res = await readPost(jsonReq('https://app.local/api/staff-chat/read', { conversationId: 'c-missing' }));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff-chat/reactions
// ---------------------------------------------------------------------------
describe('POST /api/staff-chat/reactions', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1', emoji: '👍' }));
    expect(res.status).toBe(403);
    expect(toggleReactionMock).not.toHaveBeenCalled();
  });

  it('malformed JSON → 400', async () => {
    const res = await reactionsPost(malformedJsonReq('https://app.local/api/staff-chat/reactions'));
    expect(res.status).toBe(400);
    expect(toggleReactionMock).not.toHaveBeenCalled();
  });

  it('missing emoji → 400', async () => {
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(toggleReactionMock).not.toHaveBeenCalled();
  });

  it('missing messageId → 400', async () => {
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { emoji: '👍' }));
    expect(res.status).toBe(400);
    expect(toggleReactionMock).not.toHaveBeenCalled();
  });

  it('happy path → 200 with reacted:true', async () => {
    toggleReactionMock.mockResolvedValue({ ok: true, reacted: true });
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1', emoji: '👍' }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; reacted: boolean };
    expect(json).toEqual({ ok: true, reacted: true });
    expect(toggleReactionMock).toHaveBeenCalledWith({}, managerSession(), { messageId: 'm1', emoji: '👍' });
  });

  it('service returns forbidden → 403', async () => {
    toggleReactionMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1', emoji: '👍' }));
    expect(res.status).toBe(403);
  });

  it('service returns message_not_found → 404', async () => {
    toggleReactionMock.mockResolvedValue({ ok: false, error: 'message_not_found' });
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm-missing', emoji: '👍' }));
    expect(res.status).toBe(404);
  });

  it('service returns invalid → 400', async () => {
    toggleReactionMock.mockResolvedValue({ ok: false, error: 'invalid' });
    const res = await reactionsPost(jsonReq('https://app.local/api/staff-chat/reactions', { messageId: 'm1', emoji: '🚀' }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'invalid' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff-chat/dm
// ---------------------------------------------------------------------------
describe('POST /api/staff-chat/dm', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await dmPost(jsonReq('https://app.local/api/staff-chat/dm', { targetUserId: 'u2' }));
    expect(res.status).toBe(403);
    expect(openDmMock).not.toHaveBeenCalled();
  });

  it('malformed JSON → 400', async () => {
    const res = await dmPost(malformedJsonReq('https://app.local/api/staff-chat/dm'));
    expect(res.status).toBe(400);
    expect(openDmMock).not.toHaveBeenCalled();
  });

  it('missing targetUserId → 400', async () => {
    const res = await dmPost(jsonReq('https://app.local/api/staff-chat/dm', {}));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(openDmMock).not.toHaveBeenCalled();
  });

  it('happy path → 201 with conversationId', async () => {
    openDmMock.mockResolvedValue({ ok: true, conversationId: 'dm-1' });
    const res = await dmPost(jsonReq('https://app.local/api/staff-chat/dm', { targetUserId: 'u2' }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; conversationId: string };
    expect(json).toEqual({ ok: true, conversationId: 'dm-1' });
    expect(openDmMock).toHaveBeenCalledWith({}, managerSession(), { targetUserId: 'u2' });
  });

  it('service returns forbidden → 403', async () => {
    openDmMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await dmPost(jsonReq('https://app.local/api/staff-chat/dm', { targetUserId: 'u2' }));
    expect(res.status).toBe(403);
  });

  it('service returns target_not_found → 404', async () => {
    openDmMock.mockResolvedValue({ ok: false, error: 'target_not_found' });
    const res = await dmPost(jsonReq('https://app.local/api/staff-chat/dm', { targetUserId: 'u-missing' }));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/staff-chat/colleagues
// ---------------------------------------------------------------------------
describe('GET /api/staff-chat/colleagues', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await colleaguesGet();
    expect(res.status).toBe(403);
    expect(listColleaguesMock).not.toHaveBeenCalled();
  });

  it('happy path → 200 with rows', async () => {
    listColleaguesMock.mockResolvedValue({ ok: true, rows: [{ id: 'u2', name: 'Colleague' }] });
    const res = await colleaguesGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: unknown[] };
    expect(json).toEqual({ ok: true, rows: [{ id: 'u2', name: 'Colleague' }] });
    expect(listColleaguesMock).toHaveBeenCalledWith({}, managerSession());
  });
});

// ---------------------------------------------------------------------------
// GET /api/staff-chat/unread
// ---------------------------------------------------------------------------
describe('GET /api/staff-chat/unread', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await unreadGet();
    expect(res.status).toBe(403);
    expect(staffUnreadCountMock).not.toHaveBeenCalled();
  });

  it('happy path → 200 with count', async () => {
    staffUnreadCountMock.mockResolvedValue({ ok: true, count: 4 });
    const res = await unreadGet();
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; count: number };
    expect(json).toEqual({ ok: true, count: 4 });
    expect(staffUnreadCountMock).toHaveBeenCalledWith({}, managerSession());
  });
});

// ---------------------------------------------------------------------------
// POST /api/staff-chat/attachment
// ---------------------------------------------------------------------------
function buildFormData(opts: { file?: File | null; conversationId?: string }) {
  const fd = new FormData();
  if (opts.file !== null && opts.file !== undefined) fd.set('file', opts.file);
  if (opts.conversationId !== undefined) fd.set('conversationId', opts.conversationId);
  return fd;
}

function attachmentPostReq(fd: FormData) {
  return new Request('https://app.local/api/staff-chat/attachment', { method: 'POST', body: fd });
}

describe('POST /api/staff-chat/attachment', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(403);
    expect(uploadStaffAttachmentMock).not.toHaveBeenCalled();
  });

  it('formData parse throws (non-multipart body) → 400', async () => {
    const badReq = new Request('https://app.local/api/staff-chat/attachment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: 'bad' }),
    });
    const res = await attachmentPost(badReq);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadStaffAttachmentMock).not.toHaveBeenCalled();
  });

  it('no file field → 400', async () => {
    const fd = buildFormData({ conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadStaffAttachmentMock).not.toHaveBeenCalled();
  });

  it('missing conversationId → 400', async () => {
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }) });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
    expect(uploadStaffAttachmentMock).not.toHaveBeenCalled();
  });

  it('happy path → 201 with attachmentPath', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: true, attachmentPath: 'staff-chat/c1/uuid-doc.pdf' });
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; attachmentPath: string };
    expect(json).toEqual({ ok: true, attachmentPath: 'staff-chat/c1/uuid-doc.pdf' });
    expect(uploadStaffAttachmentMock).toHaveBeenCalledTimes(1);
    const [, , args] = uploadStaffAttachmentMock.mock.calls[0]!;
    expect(args.conversationId).toBe('c1');
    expect(args.file.name).toBe('doc.pdf');
    expect(args.file.mimeType).toBe('application/pdf');
    expect(Buffer.isBuffer(args.file.buffer)).toBe(true);
  });

  it('service returns forbidden → 403', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(403);
  });

  it('service returns conversation_not_found → 404', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: false, error: 'conversation_not_found' });
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }), conversationId: 'c-missing' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(404);
  });

  it('service returns too_large → 413', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const fd = buildFormData({ file: new File(['x'], 'big.pdf', { type: 'application/pdf' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(413);
  });

  it('service returns invalid_mime → 415', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const fd = buildFormData({ file: new File(['x'], 'virus.exe', { type: 'application/x-msdownload' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(415);
  });

  it('service returns storage → 500', async () => {
    uploadStaffAttachmentMock.mockResolvedValue({ ok: false, error: 'storage' });
    const fd = buildFormData({ file: new File(['%PDF-1.4'], 'doc.pdf', { type: 'application/pdf' }), conversationId: 'c1' });
    const res = await attachmentPost(attachmentPostReq(fd));
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/staff-chat/attachment
// ---------------------------------------------------------------------------
function attachmentGetReq(messageId?: string) {
  const url = messageId
    ? `https://app.local/api/staff-chat/attachment?messageId=${messageId}`
    : 'https://app.local/api/staff-chat/attachment';
  return new Request(url);
}

describe('GET /api/staff-chat/attachment', () => {
  it('non-staff role → 403', async () => {
    requireRoleMock.mockReturnValue(forbiddenResult());
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(403);
    expect(getStaffAttachmentSignedUrlMock).not.toHaveBeenCalled();
  });

  it('missing messageId → 400', async () => {
    const res = await attachmentGet(attachmentGetReq());
    expect(res.status).toBe(400);
    expect(getStaffAttachmentSignedUrlMock).not.toHaveBeenCalled();
  });

  it('happy path → 302 redirect to signed URL', async () => {
    const signedUrl = 'https://storage.example.com/signed?token=abc';
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: true, url: signedUrl });
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(signedUrl);
    expect(getStaffAttachmentSignedUrlMock).toHaveBeenCalledWith({}, managerSession(), { messageId: 'm1' });
  });

  it('service returns forbidden → 403', async () => {
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(403);
  });

  it('service returns not_found → 404', async () => {
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await attachmentGet(attachmentGetReq('m-missing'));
    expect(res.status).toBe(404);
  });

  it('service returns not_ready → 409', async () => {
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'not_ready' });
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(409);
  });

  it('service returns infected → 410', async () => {
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'infected' });
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(410);
  });

  it('service returns storage → 502', async () => {
    getStaffAttachmentSignedUrlMock.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await attachmentGet(attachmentGetReq('m1'));
    expect(res.status).toBe(502);
  });
});
