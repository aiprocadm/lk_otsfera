import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before any module import that might
// transitively load the real implementations.
// ---------------------------------------------------------------------------
const {
  requireSessionMock,
  sendMessageMock,
  listMessagesMock,
  listThreadsMock,
  markReadMock,
  unreadCountMock,
} = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sendMessageMock: vi.fn(),
  listMessagesMock: vi.fn(),
  listThreadsMock: vi.fn(),
  markReadMock: vi.fn(),
  unreadCountMock: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession: requireSessionMock }));
vi.mock('@/lib/services/chat/messages', () => ({
  sendMessage: sendMessageMock,
  listMessages: listMessagesMock,
}));
vi.mock('@/lib/services/chat/threads', () => ({
  listThreads: listThreadsMock,
  markRead: markReadMock,
  unreadCount: unreadCountMock,
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

// ---------------------------------------------------------------------------
// Route imports (after mocks are registered)
// ---------------------------------------------------------------------------
import { POST as messagesPost, GET as messagesGet } from '@/app/api/messages/route';
import { GET as threadsGet } from '@/app/api/messages/threads/route';
import { POST as readPost } from '@/app/api/messages/read/route';
import { GET as unreadGet } from '@/app/api/messages/unread/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const routeCtx = { params: Promise.resolve({}) };

function orgSession(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'u-org-1',
    role: 'organization',
    email: 'org@local',
    orgIds: ['org-1'],
    ...overrides,
  };
}

function teamSession(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'u-mgr-1',
    role: 'manager',
    email: 'mgr@local',
    managedOrgIds: ['org-1'],
    ...overrides,
  };
}

function jsonReq(url: string, body: unknown, method = 'POST') {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// POST /api/messages
// ---------------------------------------------------------------------------
describe('POST /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('org session + valid body → 201 with messageId', async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: 'm1' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { ok: boolean; messageId: string };
    expect(json).toEqual({ ok: true, messageId: 'm1' });
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('flag OFF → 404 and service NOT called', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(404);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('missing body field → 400', async () => {
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1' }),
      routeCtx
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json).toEqual({ error: 'invalid_request' });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('missing orderId field → 400', async () => {
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json).toEqual({ error: 'invalid_request' });
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('service returns forbidden → 403', async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'forbidden' });
  });

  it('team session with body.side="org" → sendMessage called with side "org"', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, value: teamSession() });
    sendMessageMock.mockResolvedValue({ ok: true, messageId: 'm2' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hi', side: 'org' }),
      routeCtx
    );
    expect(res.status).toBe(201);
    const [, , args] = sendMessageMock.mock.calls[0]!;
    expect(args.side).toBe('org');
  });

  it('org session: deriveSide forces side "org" even if body.side="partner" is passed', async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: 'm3' });
    // body.side is partner but org role → deriveSide returns 'org' → should win
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hi', side: 'partner' }),
      routeCtx
    );
    expect(res.status).toBe(201);
    const [, , args] = sendMessageMock.mock.calls[0]!;
    expect(args.side).toBe('org');
  });

  it('team session with body.side missing → 400 (no valid side)', async () => {
    requireSessionMock.mockResolvedValue({ ok: true, value: teamSession() });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hi' }),
      routeCtx
    );
    // deriveSide returns null, body.side is undefined → neither 'org' nor 'partner'
    expect(res.status).toBe(400);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'bad_request' });
  });

  it('unauthenticated → 401 (requireSession returns not-ok)', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(401);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages
// ---------------------------------------------------------------------------
describe('GET /api/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('valid threadId → 200 with rows', async () => {
    const rows = [
      {
        id: 'msg-1',
        authorId: 'u-1',
        body: 'hi',
        hasAttachment: false,
        createdAt: new Date('2026-06-01'),
      },
    ];
    listMessagesMock.mockResolvedValue({ ok: true, rows });
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1'),
      routeCtx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; rows: unknown[] };
    expect(json.ok).toBe(true);
    expect(json.rows).toHaveLength(1);
    expect(listMessagesMock).toHaveBeenCalledWith({}, orgSession(), { threadId: 'thr-1' });
  });

  it('flag OFF → 404', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1'),
      routeCtx
    );
    expect(res.status).toBe(404);
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it('service returns forbidden → 403', async () => {
    listMessagesMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1'),
      routeCtx
    );
    expect(res.status).toBe(403);
  });

  it('service returns thread_not_found → 404', async () => {
    listMessagesMock.mockResolvedValue({ ok: false, error: 'thread_not_found' });
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1'),
      routeCtx
    );
    expect(res.status).toBe(404);
  });

  it('passes after param when provided', async () => {
    listMessagesMock.mockResolvedValue({ ok: true, rows: [] });
    await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1&after=2026-06-01T00:00:00.000Z'),
      routeCtx
    );
    expect(listMessagesMock).toHaveBeenCalledWith({}, orgSession(), {
      threadId: 'thr-1',
      after: '2026-06-01T00:00:00.000Z',
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/threads
// ---------------------------------------------------------------------------
describe('GET /api/messages/threads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('returns listThreads result directly', async () => {
    const payload = { ok: true, rows: [{ id: 'thr-1', orderId: 'ord-1', side: 'org' }] };
    listThreadsMock.mockResolvedValue(payload);
    const res = await threadsGet(new Request('https://app.local/api/messages/threads'), routeCtx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(payload);
  });

  it('flag OFF → 404', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await threadsGet(new Request('https://app.local/api/messages/threads'), routeCtx);
    expect(res.status).toBe(404);
    expect(listThreadsMock).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await threadsGet(new Request('https://app.local/api/messages/threads'), routeCtx);
    expect(res.status).toBe(401);
    expect(listThreadsMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/messages/read
// ---------------------------------------------------------------------------
describe('POST /api/messages/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('valid threadId → 200 ok:true', async () => {
    markReadMock.mockResolvedValue({ ok: true });
    const res = await readPost(
      jsonReq('https://app.local/api/messages/read', { threadId: 'thr-1' }),
      routeCtx
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean };
    expect(json).toEqual({ ok: true });
    expect(markReadMock).toHaveBeenCalledWith({}, orgSession(), 'thr-1');
  });

  it('flag OFF → 404', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await readPost(
      jsonReq('https://app.local/api/messages/read', { threadId: 'thr-1' }),
      routeCtx
    );
    expect(res.status).toBe(404);
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('missing threadId → 400', async () => {
    const res = await readPost(jsonReq('https://app.local/api/messages/read', {}), routeCtx);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json).toEqual({ error: 'invalid_request' });
    expect(markReadMock).not.toHaveBeenCalled();
  });

  it('service returns forbidden → 403', async () => {
    markReadMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await readPost(
      jsonReq('https://app.local/api/messages/read', { threadId: 'thr-1' }),
      routeCtx
    );
    expect(res.status).toBe(403);
  });

  it('service returns thread_not_found → 404', async () => {
    markReadMock.mockResolvedValue({ ok: false, error: 'thread_not_found' });
    const res = await readPost(
      jsonReq('https://app.local/api/messages/read', { threadId: 'thr-1' }),
      routeCtx
    );
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401 (requireSession not ok)', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await readPost(
      jsonReq('https://app.local/api/messages/read', { threadId: 'thr-1' }),
      routeCtx
    );
    expect(res.status).toBe(401);
    expect(markReadMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET /api/messages/unread
// ---------------------------------------------------------------------------
describe('GET /api/messages/unread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('returns unreadCount result directly', async () => {
    unreadCountMock.mockResolvedValue({ ok: true, count: 3 });
    const res = await unreadGet(new Request('https://app.local/api/messages/unread'), routeCtx);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; count: number };
    expect(json).toEqual({ ok: true, count: 3 });
    expect(unreadCountMock).toHaveBeenCalledWith({}, orgSession());
  });

  it('flag OFF → 404', async () => {
    process.env.FEATURE_CHAT = '0';
    const res = await unreadGet(new Request('https://app.local/api/messages/unread'), routeCtx);
    expect(res.status).toBe(404);
    expect(unreadCountMock).not.toHaveBeenCalled();
  });

  it('unauthenticated → 401, unreadCount not called', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await unreadGet(new Request('https://app.local/api/messages/unread'), routeCtx);
    expect(res.status).toBe(401);
    expect(unreadCountMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Additional branch coverage for POST /api/messages
// ---------------------------------------------------------------------------
describe('POST /api/messages — additional error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FEATURE_CHAT = '1';
    requireSessionMock.mockResolvedValue({ ok: true, value: orgSession() });
  });

  it('service returns order_not_found → 404', async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: 'order_not_found' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-999', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'order_not_found' });
  });

  it('service returns too_large → 413', async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'x'.repeat(10001) }),
      routeCtx
    );
    expect(res.status).toBe(413);
    const json = (await res.json()) as { ok: boolean; error: string };
    expect(json).toEqual({ ok: false, error: 'too_large' });
  });

  it('service returns unknown error → 400 (fallback status)', async () => {
    sendMessageMock.mockResolvedValue({ ok: false, error: 'unknown_error' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', { orderId: 'ord-1', body: 'hello' }),
      routeCtx
    );
    expect(res.status).toBe(400);
  });

  it('GET unauthenticated → 401', async () => {
    requireSessionMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-1'),
      routeCtx
    );
    expect(res.status).toBe(401);
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it('POST with attachmentPath string → sends attachmentPath to service', async () => {
    sendMessageMock.mockResolvedValue({ ok: true, messageId: 'm-attach' });
    const res = await messagesPost(
      jsonReq('https://app.local/api/messages', {
        orderId: 'ord-1',
        body: 'see attachment',
        attachmentPath: 'chat/ord-1/uuid-file.pdf',
      }),
      routeCtx
    );
    expect(res.status).toBe(201);
    const [, , args] = sendMessageMock.mock.calls[0]!;
    expect(args.attachmentPath).toBe('chat/ord-1/uuid-file.pdf');
  });

  it('GET without after param omitted entirely → threadId only in args', async () => {
    listMessagesMock.mockResolvedValue({ ok: true, rows: [] });
    const res = await messagesGet(
      new Request('https://app.local/api/messages?threadId=thr-2'),
      routeCtx
    );
    expect(res.status).toBe(200);
    // No after key should be present when after query param is absent
    expect(listMessagesMock).toHaveBeenCalledWith({}, orgSession(), { threadId: 'thr-2' });
  });

  it('GET without threadId → empty string falls back via ?? fallback', async () => {
    // When threadId is absent from URL, get('threadId') returns null → ?? '' → ''
    // This covers the ?? '' fallback branch on the threadId line
    listMessagesMock.mockResolvedValue({ ok: true, rows: [] });
    const res = await messagesGet(new Request('https://app.local/api/messages'), routeCtx);
    expect(res.status).toBe(200);
    expect(listMessagesMock).toHaveBeenCalledWith({}, orgSession(), { threadId: '' });
  });
});
