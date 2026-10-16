import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Роуты файлов результата задачи (этап 5 ТЗ 13.10.2026, `У-299`): только
 * флаг, сессия, разбор формы и код сервиса → статус. Скачивание — 302 на
 * временную ссылку, заражённый файл — 410 (§10).
 */
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
const { notFoundIfDisabled } = vi.hoisted(() => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
const { uploadTaskResultFile, deleteTaskResultFile, getTaskResultFileUrl } = vi.hoisted(() => ({
  uploadTaskResultFile: vi.fn(),
  deleteTaskResultFile: vi.fn(),
  getTaskResultFileUrl: vi.fn(),
}));
vi.mock('@/lib/services/tasks/result', () => ({
  uploadTaskResultFile,
  deleteTaskResultFile,
  getTaskResultFileUrl,
}));

import { POST } from '@/app/api/tasks/[id]/result-files/route';
import { GET, DELETE } from '@/app/api/tasks/result-files/[fileId]/route';

const SESSION = { sub: 'm1', role: 'manager', companyId: 'co-1' };
const taskCtx = { params: Promise.resolve({ id: 't1' }) };
const fileCtx = { params: Promise.resolve({ fileId: 'f1' }) };

function upload(withFile = true): Request {
  const fd = new FormData();
  if (withFile) fd.set('file', new File([new Uint8Array([1, 2, 3])], 'акт.pdf'));
  return new Request('http://x/', { method: 'POST', body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabled.mockReturnValue(null);
  getSession.mockResolvedValue(SESSION);
});

describe('POST /api/tasks/[id]/result-files', () => {
  it('201 и id файла; сервис получает задачу и файл', async () => {
    uploadTaskResultFile.mockResolvedValue({ ok: true, id: 'f-new' });
    const res = await POST(upload(), taskCtx);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'f-new' });
    expect(uploadTaskResultFile.mock.calls[0][1]).toBe(SESSION);
    expect(uploadTaskResultFile.mock.calls[0][2]).toMatchObject({
      taskId: 't1',
      file: { name: 'акт.pdf', size: 3 },
    });
  });

  it.each([
    ['too_large', 413],
    ['invalid_mime', 415],
    ['not_found', 404],
    ['validation', 400],
    ['storage', 500],
    ['forbidden', 403],
  ] as const)('код %s → %i', async (error, status) => {
    uploadTaskResultFile.mockResolvedValue({ ok: false, error });
    const res = await POST(upload(), taskCtx);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it('без файла и не форма — 400; без сессии — 401; флаг выключен — 404', async () => {
    expect((await POST(upload(false), taskCtx)).status).toBe(400);
    const notForm = new Request('http://x/', { method: 'POST', body: '{}' });
    expect((await POST(notForm, taskCtx)).status).toBe(400);
    getSession.mockResolvedValue(null);
    expect((await POST(upload(), taskCtx)).status).toBe(401);
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await POST(upload(), taskCtx)).status).toBe(404);
    expect(uploadTaskResultFile).not.toHaveBeenCalled();
  });
});

describe('GET/DELETE /api/tasks/result-files/[fileId]', () => {
  it('скачивание — 302 на временную ссылку; заражённый — 410', async () => {
    getTaskResultFileUrl.mockResolvedValue({ ok: true, url: 'https://s3/x' });
    const res = await GET(new Request('http://x/'), fileCtx);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://s3/x');
    getTaskResultFileUrl.mockResolvedValue({ ok: false, error: 'infected' });
    expect((await GET(new Request('http://x/'), fileCtx)).status).toBe(410);
  });

  it('удаление — ok; чужой файл — 403', async () => {
    deleteTaskResultFile.mockResolvedValue({ ok: true });
    const res = await DELETE(new Request('http://x/', { method: 'DELETE' }), fileCtx);
    expect(await res.json()).toEqual({ ok: true });
    deleteTaskResultFile.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect((await DELETE(new Request('http://x/', { method: 'DELETE' }), fileCtx)).status).toBe(
      403
    );
  });

  it('без сессии — 401, флаг выключен — 404 (оба метода)', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET(new Request('http://x/'), fileCtx)).status).toBe(401);
    expect((await DELETE(new Request('http://x/'), fileCtx)).status).toBe(401);
    notFoundIfDisabled.mockReturnValue(new Response('Not Found', { status: 404 }));
    expect((await GET(new Request('http://x/'), fileCtx)).status).toBe(404);
    expect((await DELETE(new Request('http://x/'), fileCtx)).status).toBe(404);
  });
});
