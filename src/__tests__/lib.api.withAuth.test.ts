import { z } from 'zod';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSession }));

const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import { withAuth } from '@/lib/api/withAuth';
import type { SessionPayload } from '@/lib/auth/jwt';

const session = { sub: 'u1', role: 'admin' } as SessionPayload;

const routeCtx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  requireSession.mockResolvedValue({ ok: true, value: session });
});

function post(body?: unknown) {
  return new Request('http://x', {
    method: 'POST',
    body: body === undefined ? null : JSON.stringify(body),
  });
}

describe('withAuth', () => {
  it('happy path: session + body + params доходят до обработчика', async () => {
    const handler = withAuth(
      { body: z.object({ a: z.string() }) },
      async ({ session: s, body, params }) =>
        Response.json({ sub: s.sub, a: body.a, id: (await params).id })
    );
    const res = await handler(post({ a: 'x' }), { params: Promise.resolve({ id: '7' }) });
    expect(await res.json()).toEqual({ sub: 'u1', a: 'x', id: '7' });
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('без ctx (юнит-тесты роутов) params — пустой объект', async () => {
    const handler = withAuth({}, async ({ params }) => Response.json(await params));
    expect(await (await handler(post(), routeCtx)).json()).toEqual({});
  });

  it('выключенный флаг → ответ notFoundIfDisabled до сессии', async () => {
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    const handler = withAuth({ feature: 'chat' }, async () => Response.json({}));
    const res = await handler(post(), routeCtx);
    expect(res.status).toBe(404);
    expect(requireSession).not.toHaveBeenCalled();
  });

  it('нет сессии → 401 из requireSession', async () => {
    requireSession.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const handler = withAuth({}, async () => Response.json({}));
    expect((await handler(post(), routeCtx)).status).toBe(401);
  });

  it('guard-отказ → его response, обработчик не зовётся', async () => {
    const inner = vi.fn();
    const handler = withAuth(
      {
        guard: () => ({
          ok: false,
          response: Response.json({ error: 'Forbidden' }, { status: 403 }),
        }),
      },
      inner
    );
    expect((await handler(post(), routeCtx)).status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('guard-успех: обработчик получает значение гарда', async () => {
    const narrowed = { ...session, partnerId: 'p1' } as SessionPayload;
    const handler = withAuth(
      { guard: () => ({ ok: true, value: narrowed }) },
      async ({ session: s }) => Response.json(s)
    );
    expect(await (await handler(post(), routeCtx)).json()).toEqual(narrowed);
  });

  it('кривое тело → 400 invalid_request, обработчик не зовётся', async () => {
    const inner = vi.fn();
    const handler = withAuth({ body: z.object({ a: z.string() }) }, inner);
    const res = await handler(post({ a: 1 }), routeCtx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_request' });
    expect(inner).not.toHaveBeenCalled();
  });

  it('throw обработчика → 500 internal (guardedRoute)', async () => {
    const handler = withAuth({}, async () => {
      throw new Error('boom');
    });
    const res = await handler(post(), routeCtx);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
    expect(logError).toHaveBeenCalled();
  });
});
