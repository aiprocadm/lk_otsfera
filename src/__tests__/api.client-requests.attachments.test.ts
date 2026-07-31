import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 5 PR-1: роуты вложений заявок клиентов — маппинг Result-кодов сервиса
 * в HTTP (эталон — api.enrollments.test.ts, сервис вложений замокан):
 *  - POST multipart: happy 201, коды 404/403/415/413/410 (+400 filename/форма);
 *  - GET list: {rows} / 404;
 *  - download POST: {downloadUrl}, INFECTED → 410 Gone (карантин ≠ 404).
 */

vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/services/clientRequests/attachments', () => ({
  listClientRequestAttachments: vi.fn(),
  uploadClientRequestAttachment: vi.fn(),
  getClientRequestAttachmentDownloadUrl: vi.fn(),
}));

import { getSession } from '@/lib/auth/session';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  listClientRequestAttachments,
  uploadClientRequestAttachment,
  getClientRequestAttachmentDownloadUrl,
} from '@/lib/services/clientRequests/attachments';
import { GET, POST } from '@/app/api/client-requests/[id]/attachments/route';
import { POST as DOWNLOAD } from '@/app/api/client-requests/[id]/attachments/[attachmentId]/download/route';

const partner = { sub: 'p', role: 'partner', partnerId: 'p1' } as never;
const ctx = (id = 'R1') => ({ params: Promise.resolve({ id }) });
const dlCtx = (attachmentId = 'A1') => ({ params: Promise.resolve({ id: 'R1', attachmentId }) });

const failure = (error: string, message = 'msg', meta?: { scanReason?: string | null }) =>
  ({ ok: false, error, message, ...(meta ? { meta } : {}) }) as never;

function formReq(withFile = true): Request {
  const fd = new FormData();
  if (withFile)
    fd.set(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'скан-договора.pdf', { type: 'application/pdf' })
    );
  return new Request('http://x/', { method: 'POST', body: fd });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notFoundIfDisabled).mockReturnValue(null);
  vi.mocked(getSession).mockResolvedValue(partner);
});

describe('POST /api/client-requests/[id]/attachments (multipart upload)', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await POST(formReq(), ctx())).status).toBe(404);
    expect(vi.mocked(notFoundIfDisabled)).toHaveBeenCalledWith('client_requests');
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(formReq(), ctx())).status).toBe(401);
  });

  it('400 когда тело не multipart form-data', async () => {
    const req = new Request('http://x/', {
      method: 'POST',
      body: 'plain',
      headers: { 'content-type': 'text/plain' },
    });
    const res = await POST(req, ctx());
    expect(res.status).toBe(400);
    expect(vi.mocked(uploadClientRequestAttachment)).not.toHaveBeenCalled();
  });

  it('400 когда поле "file" отсутствует', async () => {
    const res = await POST(formReq(false), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('file');
  });

  it('201 happy: сервис получает буфер и имя, ответ — подмножество полей вложения', async () => {
    const createdAt = new Date('2026-07-24T10:00:00Z');
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue({
      ok: true,
      attachment: {
        id: 'A1',
        name: 'скан-договора.pdf',
        size: 3,
        mimeType: 'application/pdf',
        createdAt,
        path: 'secret/path',
      },
    } as never);
    const res = await POST(formReq(), ctx('R1'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      id: 'A1',
      name: 'скан-договора.pdf',
      size: 3,
      mimeType: 'application/pdf',
      createdAt: createdAt.toISOString(),
    });
    expect(vi.mocked(uploadClientRequestAttachment)).toHaveBeenCalledWith({}, partner, {
      requestId: 'R1',
      file: expect.objectContaining({
        name: 'скан-договора.pdf',
        size: 3,
        buffer: expect.any(Uint8Array),
      }),
    });
  });

  it('NOT_FOUND → 404', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(
      failure('NOT_FOUND', 'Обращение не найдено')
    );
    const res = await POST(formReq(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Обращение не найдено' });
  });

  it('FORBIDDEN → 403 (вложения меняет только податель)', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('FORBIDDEN'));
    expect((await POST(formReq(), ctx())).status).toBe(403);
  });

  it('REQUEST_NOT_EDITABLE → 403 (заявка вне submitted|in_triage)', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('REQUEST_NOT_EDITABLE'));
    expect((await POST(formReq(), ctx())).status).toBe(403);
  });

  it('UNSUPPORTED_MEDIA_TYPE → 415', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('UNSUPPORTED_MEDIA_TYPE'));
    expect((await POST(formReq(), ctx())).status).toBe(415);
  });

  it('FILE_TOO_LARGE → 413', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('FILE_TOO_LARGE'));
    expect((await POST(formReq(), ctx())).status).toBe(413);
  });

  it('INVALID_FILENAME → 400', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('INVALID_FILENAME'));
    expect((await POST(formReq(), ctx())).status).toBe(400);
  });

  it('INFECTED → 410 c code и scanReason', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(
      failure('INFECTED', 'Файл помещён в карантин антивирусом', {
        scanReason: 'Eicar-Test-Signature',
      })
    );
    const res = await POST(formReq(), ctx());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      code: 'INFECTED',
      error: 'Файл помещён в карантин антивирусом',
      scanReason: 'Eicar-Test-Signature',
    });
  });

  it('INFECTED без подробностей антивируса → 410 без scanReason', async () => {
    // Антивирус не всегда сообщает, что именно нашёл. Ответ обязан остаться
    // валидным 410 с кодом карантина, а не сломаться на отсутствующем meta.
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(
      failure('INFECTED', 'Файл помещён в карантин антивирусом')
    );
    const res = await POST(formReq(), ctx());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      code: 'INFECTED',
      error: 'Файл помещён в карантин антивирусом',
    });
  });

  it('STORAGE_FAILURE → 500', async () => {
    vi.mocked(uploadClientRequestAttachment).mockResolvedValue(failure('STORAGE_FAILURE'));
    expect((await POST(formReq(), ctx())).status).toBe(500);
  });

  it('неожиданный throw сервиса → 500 Internal error', async () => {
    vi.mocked(uploadClientRequestAttachment).mockRejectedValue(new Error('boom'));
    const res = await POST(formReq(), ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal error' });
  });
});

describe('GET /api/client-requests/[id]/attachments (list)', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET(new Request('http://x/'), ctx())).status).toBe(404);
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await GET(new Request('http://x/'), ctx())).status).toBe(401);
  });

  it('200 → {rows}', async () => {
    vi.mocked(listClientRequestAttachments).mockResolvedValue({
      ok: true,
      rows: [{ id: 'A1', name: 'скан.pdf' }],
    } as never);
    const res = await GET(new Request('http://x/'), ctx('R1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: [{ id: 'A1', name: 'скан.pdf' }] });
    expect(vi.mocked(listClientRequestAttachments)).toHaveBeenCalledWith({}, partner, {
      requestId: 'R1',
    });
  });

  it('NOT_FOUND (чужая заявка) → 404', async () => {
    vi.mocked(listClientRequestAttachments).mockResolvedValue(
      failure('NOT_FOUND', 'Обращение не найдено')
    );
    expect((await GET(new Request('http://x/'), ctx())).status).toBe(404);
  });

  it('неожиданный throw сервиса → 500 Internal error', async () => {
    vi.mocked(listClientRequestAttachments).mockRejectedValue(new Error('boom'));
    expect((await GET(new Request('http://x/'), ctx())).status).toBe(500);
  });
});

describe('POST /api/client-requests/[id]/attachments/[attachmentId]/download', () => {
  it('404 when feature flag disabled', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx())).status).toBe(
      404
    );
  });

  it('401 unauthenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx())).status).toBe(
      401
    );
  });

  it('200 → {downloadUrl, name, mimeType}', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockResolvedValue({
      ok: true,
      url: 'https://storage/signed?ttl=300',
      name: 'скан.pdf',
      mimeType: 'application/pdf',
    } as never);
    const res = await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx('A1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      downloadUrl: 'https://storage/signed?ttl=300',
      name: 'скан.pdf',
      mimeType: 'application/pdf',
    });
    expect(vi.mocked(getClientRequestAttachmentDownloadUrl)).toHaveBeenCalledWith({}, partner, {
      attachmentId: 'A1',
    });
  });

  it('NOT_FOUND → 404', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockResolvedValue(
      failure('NOT_FOUND', 'Вложение не найдено')
    );
    const res = await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Вложение не найдено' });
  });

  it('INFECTED без подробностей антивируса → 410 без scanReason', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockResolvedValue(
      failure('INFECTED', 'Файл помещён в карантин антивирусом')
    );
    const res = await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      code: 'INFECTED',
      error: 'Файл помещён в карантин антивирусом',
    });
  });

  it('INFECTED → 410 Gone c code и scanReason (карантин это не 404)', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockResolvedValue(
      failure('INFECTED', 'Файл помещён в карантин антивирусом', { scanReason: 'Trojan.Generic' })
    );
    const res = await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx());
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      code: 'INFECTED',
      error: 'Файл помещён в карантин антивирусом',
      scanReason: 'Trojan.Generic',
    });
  });

  it('STORAGE_FAILURE → 500', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockResolvedValue(failure('STORAGE_FAILURE'));
    expect((await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx())).status).toBe(
      500
    );
  });

  it('неожиданный throw сервиса → 500 Internal error', async () => {
    vi.mocked(getClientRequestAttachmentDownloadUrl).mockRejectedValue(new Error('boom'));
    expect((await DOWNLOAD(new Request('http://x/', { method: 'POST' }), dlCtx())).status).toBe(
      500
    );
  });
});
