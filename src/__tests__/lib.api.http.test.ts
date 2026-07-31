import { z } from 'zod';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { logError } = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError } }));

import {
  REQUEST_ID_HEADER,
  resolveRequestId,
  withRequestId,
  jsonError,
  parseJsonBody,
  parseQuery,
  guardedRoute,
} from '@/lib/api/http';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveRequestId', () => {
  it('берёт входящий x-request-id', () => {
    const req = new Request('http://x', { headers: { [REQUEST_ID_HEADER]: 'rid-42' } });
    expect(resolveRequestId(req)).toBe('rid-42');
  });

  it('генерирует uuid, когда заголовка нет', () => {
    const rid = resolveRequestId(new Request('http://x'));
    expect(rid).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('withRequestId / jsonError', () => {
  it('withRequestId ставит заголовок', () => {
    const res = withRequestId(jsonError('x', 400), 'rid-1');
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('rid-1');
  });

  it('jsonError: форма { error: code } + extra и статус', async () => {
    const res = jsonError('not_found', 404, { messages: ['a'] });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', messages: ['a'] });
  });
});

describe('parseJsonBody', () => {
  const schema = z.object({ name: z.string() });

  it('ok при валидной форме', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 'a' }) });
    const parsed = await parseJsonBody(req, schema);
    expect(parsed).toEqual({ ok: true, data: { name: 'a' } });
  });

  it('кривой JSON → 400 invalid_request', async () => {
    const req = new Request('http://x', { method: 'POST', body: 'не json' });
    const parsed = await parseJsonBody(req, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('несоответствие схеме → 400 invalid_request', async () => {
    const req = new Request('http://x', { method: 'POST', body: JSON.stringify({ name: 5 }) });
    const parsed = await parseJsonBody(req, schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
  });
});

describe('parseQuery', () => {
  const schema = z.object({ q: z.string() });

  it('ok при валидном query', () => {
    const parsed = parseQuery(new Request('http://x/?q=abc'), schema);
    expect(parsed).toEqual({ ok: true, data: { q: 'abc' } });
  });

  it('несоответствие схеме → 400 invalid_request', async () => {
    const parsed = parseQuery(new Request('http://x/'), schema);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.response.status).toBe(400);
      expect(await parsed.response.json()).toEqual({ error: 'invalid_request' });
    }
  });
});

describe('guardedRoute', () => {
  it('прокидывает request-id в ответ обработчика', async () => {
    const req = new Request('http://x', { headers: { [REQUEST_ID_HEADER]: 'rid-7' } });
    const res = await guardedRoute(req, async (rid) => Response.json({ rid }));
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('rid-7');
    expect(await res.json()).toEqual({ rid: 'rid-7' });
  });

  it('необработанный throw → 500 internal без стектрейса + лог', async () => {
    const res = await guardedRoute(new Request('http://x'), async () => {
      throw new Error('boom');
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal' });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});
