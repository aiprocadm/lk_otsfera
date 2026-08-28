import { describe, it, expect, vi, beforeEach } from 'vitest';

const { previewMock, requireSessionMock, notFoundIfDisabledMock } = vi.hoisted(() => ({
  previewMock: vi.fn(),
  requireSessionMock: vi.fn(),
  notFoundIfDisabledMock: vi.fn(),
}));
vi.mock('@/lib/services/documents/generate', () => ({ previewOrderDocument: previewMock }));
vi.mock('@/lib/auth/guard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/guard')>('@/lib/auth/guard');
  return { ...actual, requireSession: requireSessionMock };
});
vi.mock('@/lib/featureFlags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/featureFlags')>('@/lib/featureFlags');
  return { ...actual, notFoundIfDisabled: notFoundIfDisabledMock };
});
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/manager/documents/preview/route';

/**
 * `У-147` — предпросмотр документа до выпуска.
 *
 * Роут обязан быть тонким: гейт роли, форма входа, сервис. Отдельно
 * проверяем, что предпросмотр не притворяется выпуском — он отдаёт файл и не
 * трогает ни номер, ни базу (это уже забота сервиса, см. его тесты).
 */
function post(body: unknown): Request {
  return new Request('http://localhost/api/manager/documents/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Роут Next 15 всегда принимает второй аргумент; у этого роута параметров нет. */
const NO_PARAMS = { params: Promise.resolve({}) };

const call = (body: unknown) => POST(post(body), NO_PARAMS);

const VALID = { orderId: 'ord-1', docType: 'invoice' };

beforeEach(() => {
  vi.clearAllMocks();
  notFoundIfDisabledMock.mockReturnValue(null);
  requireSessionMock.mockResolvedValue({
    ok: true,
    value: { sub: 'm1', role: 'manager', companyId: 'co-A' },
  });
  previewMock.mockResolvedValue({ ok: true, buffer: Buffer.from('%PDF-fake') });
});

describe('POST /api/manager/documents/preview', () => {
  it('отдаёт PDF на просмотр, а не на скачивание', async () => {
    const res = await call(VALID);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Content-Disposition')).toContain('inline');
    // Предпросмотр не кэшируем: строки правятся, файл меняется каждый раз.
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('заказчик и партнёр к предпросмотру не допускаются', async () => {
    requireSessionMock.mockResolvedValue({
      ok: true,
      value: { sub: 'o1', role: 'organization' },
    });
    expect((await call(VALID)).status).toBe(403);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('руководитель и админ допускаются — это тот же контур', async () => {
    for (const role of ['leader', 'admin']) {
      requireSessionMock.mockResolvedValue({ ok: true, value: { sub: 'u', role } });
      expect((await call(VALID)).status).toBe(200);
    }
  });

  it('кривая форма входа → 400, сервис не зовётся', async () => {
    expect((await call({ orderId: 'ord-1', docType: 'waybill' })).status).toBe(400);
    expect((await call({ docType: 'invoice' })).status).toBe(400);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('коды сервиса превращаются в статусы: not_found → 404, forbidden → 403', async () => {
    previewMock.mockResolvedValue({ ok: false, error: 'not_found' });
    expect((await call(VALID)).status).toBe(404);

    previewMock.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect((await call(VALID)).status).toBe(403);

    previewMock.mockResolvedValue({ ok: false, error: 'missing_requisites' });
    expect((await call(VALID)).status).toBe(400);
  });

  it('выключенный флаг закрывает раздел, не раскрывая его существования', async () => {
    notFoundIfDisabledMock.mockReturnValue(new Response('not found', { status: 404 }));
    expect((await call(VALID)).status).toBe(404);
    expect(previewMock).not.toHaveBeenCalled();
  });

  it('поля формы доезжают до сервиса разобранными датами', async () => {
    await call({
      ...VALID,
      docType: 'act',
      documentDate: '2026-08-27',
      periodFrom: '2026-08-01',
      periodTo: '2026-08-31',
      parentDocumentId: 'inv-7',
    });
    const args = previewMock.mock.calls[0]![2];
    expect(args.extras.documentDate).toBeInstanceOf(Date);
    expect(args.extras.periodFrom.toISOString()).toContain('2026-08-01');
    expect(args.extras.parentDocumentId).toBe('inv-7');
  });
});
