import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Два роута вложений переписки (`У-204`): положить файл и забрать его.
 *
 * Роуты тонкие (§3) — вся проверка в сервисе. Здесь проверяется ровно перевод
 * кода сервиса в статус: именно он различает «заражён навсегда» (410),
 * «проверка ещё идёт» (409) и «нет такого» (404), и именно он ломается молча,
 * если ветку забыть.
 */
const { requireManager, notFoundIfDisabled, sendDialogAttachment, getDialogAttachmentUrl } =
  vi.hoisted(() => ({
    requireManager: vi.fn(),
    notFoundIfDisabled: vi.fn(),
    sendDialogAttachment: vi.fn(),
    getDialogAttachmentUrl: vi.fn(),
  }));

vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('@/lib/services/messengers/attachment', () => ({
  sendDialogAttachment,
  getDialogAttachmentUrl,
}));

import { POST } from '@/app/api/manager/messengers/[id]/attachment/route';
import { GET } from '@/app/api/manager/messengers/[id]/attachment/[messageId]/route';

const SESSION = { sub: 'u1', role: 'manager', email: 'm@x.ru', companyId: 'c1' };

function upload(file: File | null): Request {
  const fd = new FormData();
  if (file) fd.set('file', file);
  return new Request('http://localhost/api/manager/messengers/d1/attachment', {
    method: 'POST',
    body: fd,
  });
}

const params = Promise.resolve({ id: 'd1' });
const downloadParams = Promise.resolve({ id: 'd1', messageId: 'msg1' });

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(undefined);
  requireManager.mockResolvedValue(SESSION);
});

describe('POST .../attachment — сотрудник прикладывает файл', () => {
  it('выключённый рычаг закрывает роут, не раскрывая механизм', async () => {
    const closed = new Response(null, { status: 404 });
    notFoundIfDisabled.mockReturnValue(closed);

    await expect(POST(upload(new File(['x'], 'a.pdf')), { params })).resolves.toBe(closed);
    expect(requireManager).not.toHaveBeenCalled();
  });

  it('успех отдаёт 201 и номер сообщения', async () => {
    sendDialogAttachment.mockResolvedValue({ ok: true, messageId: 'msg-7' });

    const res = await POST(upload(new File(['данные'], 'акт.pdf', { type: 'application/pdf' })), {
      params,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, messageId: 'msg-7' });
    expect(sendDialogAttachment).toHaveBeenCalledWith(
      {},
      SESSION,
      expect.objectContaining({ dialogId: 'd1' })
    );
  });

  it('форма без файла — 400, а не молчание', async () => {
    const res = await POST(upload(null), { params });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'bad_request' });
    expect(sendDialogAttachment).not.toHaveBeenCalled();
  });

  it('тело не форма — тоже 400', async () => {
    const req = new Request('http://localhost/api/manager/messengers/d1/attachment', {
      method: 'POST',
      body: 'не форма',
      headers: { 'content-type': 'text/plain' },
    });

    const res = await POST(req, { params });

    expect(res.status).toBe(400);
  });

  it.each([
    ['forbidden', 403],
    ['not_found', 404],
    ['too_large', 413],
    ['invalid_mime', 415],
    ['channel_no_attachments', 422],
    ['storage', 500],
  ])('код сервиса «%s» превращается в %i', async (error, status) => {
    sendDialogAttachment.mockResolvedValue({ ok: false, error });

    const res = await POST(upload(new File(['x'], 'a.pdf')), { params });

    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ ok: false, error });
  });
});

describe('GET .../attachment/[messageId] — забрать вложение', () => {
  it('выключённый рычаг закрывает роут', async () => {
    const closed = new Response(null, { status: 404 });
    notFoundIfDisabled.mockReturnValue(closed);

    await expect(GET(new Request('http://localhost/x'), { params: downloadParams })).resolves.toBe(
      closed
    );
  });

  it('успех — 302 на подписанную ссылку хранилища, файл через себя не гоним', async () => {
    getDialogAttachmentUrl.mockResolvedValue({ ok: true, url: 'https://s3.local/подпись' });

    const res = await GET(new Request('http://localhost/x'), { params: downloadParams });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(
      'https://s3.local/%D0%BF%D0%BE%D0%B4%D0%BF%D0%B8%D1%81%D1%8C'
    );
    expect(getDialogAttachmentUrl).toHaveBeenCalledWith({}, SESSION, {
      dialogId: 'd1',
      messageId: 'msg1',
    });
  });

  it.each([
    ['forbidden', 403],
    ['not_ready', 409],
    ['infected', 410],
    ['storage', 502],
    ['not_found', 404],
  ])('код сервиса «%s» превращается в %i', async (error, status) => {
    getDialogAttachmentUrl.mockResolvedValue({ ok: false, error });

    const res = await GET(new Request('http://localhost/x'), { params: downloadParams });

    expect(res.status).toBe(status);
  });
});
