/**
 * Этап 9 (ФТ-11.1) — POST /api/support/question: флаг, авторизация,
 * разбор multipart, маппинг Result→HTTP.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { notFoundIfDisabled, getSession, submitCabinetQuestion } = vi.hoisted(() => ({
  notFoundIfDisabled: vi.fn(),
  getSession: vi.fn(),
  submitCabinetQuestion: vi.fn()
}));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/inbound/cabinetQuestion', () => ({ submitCabinetQuestion }));

import { POST } from '@/app/api/support/question/route';

const SESSION = { sub: 'u1', role: 'organization' };

function req(fields: Record<string, string>, file?: File): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set('file', file);
  return new Request('http://localhost/api/support/question', { method: 'POST', body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  getSession.mockResolvedValue(SESSION);
  submitCabinetQuestion.mockResolvedValue({ ok: true, id: 'i1', code: 'ОБР-3F7A2C' });
});

describe('POST /api/support/question', () => {
  it('флаг выключен → ответ notFoundIfDisabled, сервис не зовётся', async () => {
    const denied = new Response('nf', { status: 404 });
    notFoundIfDisabled.mockReturnValue(denied);
    expect(await POST(req({ subject: 'a', body: 'b' }))).toBe(denied);
    expect(submitCabinetQuestion).not.toHaveBeenCalled();
  });

  it('без сессии → 401', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req({ subject: 'a', body: 'b' }));
    expect(res.status).toBe(401);
  });

  it('успех → 201 с кодом обращения', async () => {
    const res = await POST(req({ subject: 'Тема', body: 'Текст' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'i1', code: 'ОБР-3F7A2C' });
    expect(submitCabinetQuestion).toHaveBeenCalledWith({}, SESSION, expect.objectContaining({ subject: 'Тема', body: 'Текст', file: null }));
  });

  it('файл передаётся сервису буфером; пустой файл игнорируется', async () => {
    const file = new File([Buffer.from('%PDF-1.4')], 'doc.pdf', { type: 'application/pdf' });
    await POST(req({ subject: 'a', body: 'b' }, file));
    const passed = submitCabinetQuestion.mock.calls[0]![2].file;
    expect(passed).toMatchObject({ name: 'doc.pdf', type: 'application/pdf' });
    expect(Buffer.isBuffer(passed.buffer)).toBe(true);

    submitCabinetQuestion.mockClear();
    const empty = new File([], 'empty.pdf', { type: 'application/pdf' });
    await POST(req({ subject: 'a', body: 'b' }, empty));
    expect(submitCabinetQuestion.mock.calls[0]![2].file).toBeNull();
  });

  it.each([
    ['forbidden', 403],
    ['validation', 400],
    ['too_large', 413],
    ['invalid_mime', 415],
    ['storage', 502]
  ])('ошибка %s → HTTP %i', async (error, status) => {
    submitCabinetQuestion.mockResolvedValue({ ok: false, error, messages: ['msg'] });
    const res = await POST(req({ subject: 'a', body: 'b' }));
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, messages: ['msg'] });
  });

  it('нечитаемое тело → 400', async () => {
    const bad = new Request('http://localhost/api/support/question', { method: 'POST', body: 'not-form', headers: { 'content-type': 'text/plain' } });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
