import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 5 PR-1: тонкие роуты заявок клиентов (/api/client-requests) —
 * только маппинг Result-кодов сервисов в HTTP (эталон — api.enrollments.test.ts).
 * POST: 404 (флаг) / 401 / 403 / 400+messages / 201 {id};
 * GET: список + query status/cursor; PATCH [id]: три action + маппинг
 * 403/404/409/400, convert возвращает leadId; неизвестный action → 400.
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/clientRequests/submit', () => ({ submitClientRequest: vi.fn() }));
vi.mock('@/lib/services/clientRequests/list', () => ({
  listClientRequests: vi.fn(),
  getClientRequest: vi.fn()
}));
vi.mock('@/lib/services/clientRequests/triage', () => ({
  takeInTriage: vi.fn(),
  convertToLead: vi.fn(),
  rejectClientRequest: vi.fn()
}));

import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitClientRequest } from '@/lib/services/clientRequests/submit';
import { listClientRequests, getClientRequest } from '@/lib/services/clientRequests/list';
import { takeInTriage, convertToLead, rejectClientRequest } from '@/lib/services/clientRequests/triage';
import { POST, GET } from '@/app/api/client-requests/route';
import { GET as GET_ID, PATCH } from '@/app/api/client-requests/[id]/route';

const partner = { sub: 'p', role: 'partner', partnerId: 'p1' } as never;
const manager = { sub: 'm', role: 'manager' } as never;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const jsonReq = (b: unknown, method = 'POST') =>
  new Request('http://x/', { method, body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notFoundIfDisabled).mockReturnValue(null);
});

describe('POST /api/client-requests', () => {
  it('404 when feature flag disabled (сессия не запрашивается)', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await POST(jsonReq({}))).status).toBe(404);
    expect(vi.mocked(notFoundIfDisabled)).toHaveBeenCalledWith('client_requests');
    expect(vi.mocked(getSession)).not.toHaveBeenCalled();
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(jsonReq({}))).status).toBe(401);
  });

  it('400 when body is not JSON', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    const req = new Request('http://x/', { method: 'POST', body: 'not-json', headers: { 'content-type': 'text/plain' } });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(vi.mocked(submitClientRequest)).not.toHaveBeenCalled();
  });

  it('maps forbidden Result → 403 (messages по умолчанию [])', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(submitClientRequest).mockResolvedValue({ ok: false, error: 'forbidden' } as never);
    const res = await POST(jsonReq({ companyName: 'ООО' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', messages: [] });
  });

  it('maps validation Result → 400, русские messages пробрасываются', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitClientRequest).mockResolvedValue({
      ok: false,
      error: 'validation',
      messages: ['Укажите название компании', 'Укажите телефон или email для связи']
    } as never);
    const res = await POST(jsonReq({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'validation',
      messages: ['Укажите название компании', 'Укажите телефон или email для связи']
    });
  });

  it('201 happy: {id}; строки прокинуты, не-строки → null', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(submitClientRequest).mockResolvedValue({ ok: true, request: { id: 'R1' } } as never);
    const res = await POST(
      jsonReq({
        companyName: 'ООО Ромашка',
        inn: 1234567890, // число, не строка → null
        contactName: 'Иван',
        contactPhone: '+7 900 000-00-00',
        contactEmail: 'ivan@x.ru',
        subject: 'Обучение',
        body: 'Хотим обучить 5 человек',
        organizationId: null
      })
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'R1' });
    expect(vi.mocked(submitClientRequest)).toHaveBeenCalledWith({}, partner, {
      companyName: 'ООО Ромашка',
      inn: null,
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
      contactEmail: 'ivan@x.ru',
      subject: 'Обучение',
      body: 'Хотим обучить 5 человек',
      organizationId: null
    });
  });
});

describe('GET /api/client-requests', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET(new Request('http://x/api/client-requests'))).status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(new Request('http://x/api/client-requests'))).status).toBe(401);
  });

  it('200: результат сервиса отдаётся как есть', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(listClientRequests).mockResolvedValue({ rows: [{ id: 'R1' }], nextCursor: null } as never);
    const res = await GET(new Request('http://x/api/client-requests'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [{ id: 'R1' }], nextCursor: null });
    expect(vi.mocked(listClientRequests)).toHaveBeenCalledWith({}, manager, { status: undefined, cursor: undefined });
  });

  it('валидный status и cursor из query уходят в сервис', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(listClientRequests).mockResolvedValue({ rows: [], nextCursor: null } as never);
    const res = await GET(new Request('http://x/api/client-requests?status=in_triage&cursor=abc'));
    expect(res.status).toBe(200);
    expect(vi.mocked(listClientRequests)).toHaveBeenCalledWith({}, manager, { status: 'in_triage', cursor: 'abc' });
  });

  it('неизвестный status игнорируется (status: undefined)', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(listClientRequests).mockResolvedValue({ rows: [], nextCursor: null } as never);
    await GET(new Request('http://x/api/client-requests?status=bogus'));
    expect(vi.mocked(listClientRequests)).toHaveBeenCalledWith({}, manager, expect.objectContaining({ status: undefined }));
  });
});

describe('GET /api/client-requests/[id]', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET_ID(new Request('http://x/'), ctx('R1'))).status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET_ID(new Request('http://x/'), ctx('R1'))).status).toBe(401);
  });

  it('not_found (чужая = несуществующая) → 404', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(getClientRequest).mockResolvedValue({ ok: false, error: 'not_found' } as never);
    const res = await GET_ID(new Request('http://x/'), ctx('чужая'));
    expect(res.status).toBe(404);
    expect(vi.mocked(getClientRequest)).toHaveBeenCalledWith({}, partner, 'чужая');
  });

  it('200 → {request}', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(getClientRequest).mockResolvedValue({ ok: true, request: { id: 'R1', subject: 'Обучение' } } as never);
    const res = await GET_ID(new Request('http://x/'), ctx('R1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request: { id: 'R1', subject: 'Обучение' } });
  });
});

describe('PATCH /api/client-requests/[id]', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R1'))).status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R1'))).status).toBe(401);
  });

  it('takeInTriage: forbidden → 403', async () => {
    vi.mocked(getSession).mockResolvedValue(partner);
    vi.mocked(takeInTriage).mockResolvedValue({ ok: false, error: 'forbidden' } as never);
    const res = await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('takeInTriage: not_found → 404', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(takeInTriage).mockResolvedValue({ ok: false, error: 'not_found' } as never);
    expect((await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R404'))).status).toBe(404);
  });

  it('takeInTriage: lifecycle_violation → 409', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(takeInTriage).mockResolvedValue({ ok: false, error: 'lifecycle_violation' } as never);
    expect((await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R1'))).status).toBe(409);
  });

  it('takeInTriage: 200 → {request}', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(takeInTriage).mockResolvedValue({ ok: true, request: { id: 'R1', status: 'in_triage' } } as never);
    const res = await PATCH(jsonReq({ action: 'takeInTriage' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request: { id: 'R1', status: 'in_triage' } });
    expect(vi.mocked(takeInTriage)).toHaveBeenCalledWith({}, manager, { id: 'R1' });
  });

  it('convertToLead: 200 → {request, leadId}', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(convertToLead).mockResolvedValue({
      ok: true,
      request: { id: 'R1', status: 'converted' },
      lead: { id: 'L1' }
    } as never);
    const res = await PATCH(jsonReq({ action: 'convertToLead' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ request: { id: 'R1', status: 'converted' }, leadId: 'L1' });
  });

  it('convertToLead: lifecycle_violation (повторная конвертация) → 409', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(convertToLead).mockResolvedValue({ ok: false, error: 'lifecycle_violation' } as never);
    const res = await PATCH(jsonReq({ action: 'convertToLead' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'lifecycle_violation' });
  });

  it('reject: 200, причина прокинута в сервис', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(rejectClientRequest).mockResolvedValue({ ok: true, request: { id: 'R1', status: 'rejected' } } as never);
    const res = await PATCH(jsonReq({ action: 'reject', reason: 'Дубль' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(200);
    expect(vi.mocked(rejectClientRequest)).toHaveBeenCalledWith({}, manager, { id: 'R1', reason: 'Дубль' });
  });

  it('reject без reason → сервису уходит пустая строка', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(rejectClientRequest).mockResolvedValue({ ok: true, request: { id: 'R1', status: 'rejected' } } as never);
    expect((await PATCH(jsonReq({ action: 'reject' }, 'PATCH'), ctx('R1'))).status).toBe(200);
    expect(vi.mocked(rejectClientRequest)).toHaveBeenCalledWith({}, manager, { id: 'R1', reason: '' });
  });

  it('reject: validation → 400', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    vi.mocked(rejectClientRequest).mockResolvedValue({ ok: false, error: 'validation' } as never);
    expect((await PATCH(jsonReq({ action: 'reject', reason: '' }, 'PATCH'), ctx('R1'))).status).toBe(400);
  });

  it('неизвестный action → 400, ни один сервис не вызван', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    const res = await PATCH(jsonReq({ action: 'nope' }, 'PATCH'), ctx('R1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('takeInTriage|convertToLead|reject');
    expect(vi.mocked(takeInTriage)).not.toHaveBeenCalled();
    expect(vi.mocked(convertToLead)).not.toHaveBeenCalled();
    expect(vi.mocked(rejectClientRequest)).not.toHaveBeenCalled();
  });

  it('не-JSON тело → action undefined → 400', async () => {
    vi.mocked(getSession).mockResolvedValue(manager);
    const req = new Request('http://x/', { method: 'PATCH', body: 'oops', headers: { 'content-type': 'text/plain' } });
    expect((await PATCH(req, ctx('R1'))).status).toBe(400);
  });
});
