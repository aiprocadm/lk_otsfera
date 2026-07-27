import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Этап 12 PR-2 (ФТ-5.3) — роут массовой загрузки сканов: тонкий, вся логика в
 * сервисе. Проверяем разбор формы (пары file/orderItemId по порядку) и маппинг
 * кодов в HTTP-статусы.
 */

const { getSession, uploadCertificateScansMock } = vi.hoisted(() => ({
  getSession: vi.fn(),
  uploadCertificateScansMock: vi.fn()
}));

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('REDIRECT');
  }),
  notFound: () => {
    throw new Error('NOTFOUND');
  }
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled: vi.fn() }));
vi.mock('@/lib/services/manager/certificateScans', () => ({
  uploadCertificateScans: uploadCertificateScansMock
}));

import { POST } from '@/app/api/manager/orders/[id]/certificate-scans/route';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const paramsP = { params: Promise.resolve({ id: 'ord-1' }) };

function pdf(name: string) {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
}

function buildReq(pairs: Array<{ file?: File; itemId?: string }>) {
  const fd = new FormData();
  for (const p of pairs) {
    if (p.file) fd.append('file', p.file);
    if (p.itemId !== undefined) fd.append('orderItemId', p.itemId);
  }
  return new Request('https://app.local/api/manager/orders/ord-1/certificate-scans', {
    method: 'POST',
    body: fd
  });
}

describe('POST /api/manager/orders/[id]/certificate-scans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `managedOrgIds` обязателен: без него requireManager считает сессию
    // недозагруженной и редиректит на /login.
    getSession.mockResolvedValue({
      sub: 'u-mgr',
      role: 'manager',
      email: 'm@local',
      managedOrgIds: ['org-a']
    });
    vi.mocked(notFoundIfDisabled).mockReturnValue(undefined as never);
    uploadCertificateScansMock.mockResolvedValue({ ok: true, results: [] });
  });

  it('флаг кабинета выключен → ответ флага, сервис не зовётся', async () => {
    vi.mocked(notFoundIfDisabled).mockReturnValue(
      Response.json({ error: 'not_found' }, { status: 404 }) as never
    );
    const res = await POST(buildReq([{ file: pdf('a.pdf'), itemId: 'i1' }]) as never, paramsP);
    expect(res.status).toBe(404);
    expect(uploadCertificateScansMock).not.toHaveBeenCalled();
  });

  it('форма без файлов → 400', async () => {
    const res = await POST(buildReq([]) as never, paramsP);
    expect(res.status).toBe(400);
    expect(uploadCertificateScansMock).not.toHaveBeenCalled();
  });

  it('число файлов не совпало с числом позиций → 400', async () => {
    const res = await POST(
      buildReq([{ file: pdf('a.pdf'), itemId: 'i1' }, { file: pdf('b.pdf') }]) as never,
      paramsP
    );
    expect(res.status).toBe(400);
    expect(uploadCertificateScansMock).not.toHaveBeenCalled();
  });

  it('тело не форма → 400', async () => {
    const req = new Request('https://app.local/api/manager/orders/ord-1/certificate-scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"nope":1}'
    });
    const res = await POST(req as never, paramsP);
    expect(res.status).toBe(400);
  });

  it('пары file/orderItemId передаются в сервис по порядку', async () => {
    uploadCertificateScansMock.mockResolvedValue({
      ok: true,
      results: [{ fileName: 'a.pdf', ok: true, orderItemId: 'i1', documentId: 'd1' }]
    });
    const res = await POST(
      buildReq([
        { file: pdf('a.pdf'), itemId: 'i1' },
        { file: pdf('b.pdf'), itemId: 'i2' }
      ]) as never,
      paramsP
    );
    expect(res.status).toBe(200);
    const call = uploadCertificateScansMock.mock.calls[0][2];
    expect(call.orderId).toBe('ord-1');
    expect(call.files.map((f: { orderItemId: string }) => f.orderItemId)).toEqual(['i1', 'i2']);
    expect(call.files[0].file).toMatchObject({ name: 'a.pdf', mimeType: 'application/pdf' });
    expect(Buffer.isBuffer(call.files[0].file.buffer)).toBe(true);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      results: [{ fileName: 'a.pdf', ok: true, orderItemId: 'i1', documentId: 'd1' }]
    });
  });

  it('коды сервиса маппятся: forbidden → 403, not_found → 404, validation → 400', async () => {
    for (const [error, status] of [
      ['forbidden', 403],
      ['not_found', 404],
      ['validation', 400]
    ] as const) {
      uploadCertificateScansMock.mockResolvedValue({ ok: false, error });
      const res = await POST(buildReq([{ file: pdf('a.pdf'), itemId: 'i1' }]) as never, paramsP);
      expect(res.status).toBe(status);
      await expect(res.json()).resolves.toEqual({ ok: false, error });
    }
  });
});
