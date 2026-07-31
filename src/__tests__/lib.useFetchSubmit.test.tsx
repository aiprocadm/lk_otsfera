import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { buildFetchAction, useFetchSubmit } from '@/lib/ui/useFetchSubmit';
import { resolveErrorText, type ActionResult } from '@/lib/ui/useFormAction';

// Classic-JSX: `import React` mandatory (vitest has no react plugin → renderToString
// throws "React is not defined" otherwise). Environment is `node` (no jsdom), so the
// fetch→ActionResult mapping is tested through the pure `buildFetchAction` builder;
// the hook's idle render is checked with renderToString like the existing pattern.

describe('buildFetchAction (fetch → ActionResult)', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.restoreAllMocks();
  });

  it('ok JSON: возвращает { ok:true, ...body }; JSON body отправлен с content-type', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'lead1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    const action = buildFetchAction<{ id: string }>({
      url: '/api/partner/leads',
      body: (fd) => ({ subject: fd.get('subject') }),
    });
    const fd = new FormData();
    fd.set('subject', 'hi');
    const result = await action(fd);

    expect(result).toEqual({ ok: true, id: 'lead1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/partner/leads');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toEqual({ 'content-type': 'application/json' });
    expect((init as RequestInit).body).toBe(JSON.stringify({ subject: 'hi' }));
  });

  it('FormData body отправляется как есть (без content-type)', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 201 }));

    const sent = new FormData();
    sent.set('file', 'x');
    const action = buildFetchAction({ url: '/api/upload', body: (fd) => fd });
    const result = await action(sent);

    expect(result).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).body).toBe(sent);
    expect((init as RequestInit).headers).toBeUndefined();
  });

  it('204 No Content трактуется как успех с пустым data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const action = buildFetchAction({ url: '/api/x', method: 'DELETE' });
    expect(await action(new FormData())).toEqual({ ok: true });
  });

  it('non-ok с {error}: возвращает этот код', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'EMAIL_TAKEN' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      })
    );
    const action = buildFetchAction({ url: '/api/x', body: () => ({}) });
    const result = await action(new FormData());
    expect(result).toEqual({ ok: false, error: 'EMAIL_TAKEN' });
  });

  it('non-ok без error-тела: synthetic http_<status>', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }));
    const action = buildFetchAction({ url: '/api/x', body: () => ({}) });
    expect(await action(new FormData())).toEqual({ ok: false, error: 'http_500' });
  });

  it('сетевой сбой → код network', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const action = buildFetchAction({ url: '/api/x', body: () => ({}) });
    expect(await action(new FormData())).toEqual({ ok: false, error: 'network' });
  });
});

describe('errorMap precedence (как использует форма)', () => {
  it('errorMap имеет приоритет над errorMessageRu', () => {
    expect(resolveErrorText('EMAIL_TAKEN', { EMAIL_TAKEN: 'Email занят' })).toBe('Email занят');
  });
  it('http_<status> без маппинга → generic fallback', () => {
    expect(resolveErrorText('http_500')).toBe('Ошибка: http_500');
  });
  it('network резолвится через общий словарь', () => {
    expect(resolveErrorText('network')).toBe(
      'Сетевая ошибка. Проверьте соединение и попробуйте снова.'
    );
  });
});

describe('useFetchSubmit (начальное состояние)', () => {
  function Probe() {
    const { pending, errorText, data, success, formAction } = useFetchSubmit({
      url: '/api/x',
      body: () => ({}),
    });
    return (
      <form action={formAction}>
        <output>{JSON.stringify({ pending, errorText, data, success })}</output>
      </form>
    );
  }

  it('idle: pending=false, errorText=null, data=null, success=false', () => {
    const html = renderToString(<Probe />).replace(/&quot;/g, '"');
    expect(html).toContain(
      JSON.stringify({ pending: false, errorText: null, data: null, success: false })
    );
  });
});

// keeps the ActionResult import meaningful for type-coverage of the builder generic
const _typecheck: ActionResult<{ id: string }> = { ok: true, id: 'x' };
void _typecheck;
