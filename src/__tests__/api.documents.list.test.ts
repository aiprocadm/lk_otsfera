import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireRole, documentFindMany, documentCount } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  documentFindMany: vi.fn(),
  documentCount: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { document: { findMany: documentFindMany, count: documentCount } },
}));
vi.mock('@/lib/services/scan/visibility', () => ({
  hideInfectedForSession: vi.fn(() => ({})),
}));

import { GET } from '@/app/api/documents/route';
import { DOCUMENTS_API_CAP } from '@/lib/services/documents/list';

const adminSession = { sub: 'u-admin', role: 'admin' as const };
const orgSession = { sub: 'u-org', role: 'organization' as const };

const unauthorizedResponse = Response.json({ error: 'Unauthorized' }, { status: 401 });
const forbiddenResponse = Response.json({ error: 'Forbidden' }, { status: 403 });

describe('GET /api/documents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    documentFindMany.mockResolvedValue([]);
    documentCount.mockResolvedValue(0);
  });

  it('401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({ ok: false, response: unauthorizedResponse });
    const res = await GET(new Request('http://localhost/api/documents'));
    expect(res.status).toBe(401);
    expect(documentFindMany).not.toHaveBeenCalled();
  });

  it('403 when role is not admin', async () => {
    requireSession.mockResolvedValue({ ok: true, value: orgSession });
    requireRole.mockReturnValue({ ok: false, response: forbiddenResponse });
    const res = await GET(new Request('http://localhost/api/documents'));
    expect(res.status).toBe(403);
    expect(documentFindMany).not.toHaveBeenCalled();
  });

  it('200 with documents list for admin', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    documentFindMany.mockResolvedValue([
      {
        id: 'd1',
        name: 'contract.pdf',
        mimeType: 'application/pdf',
        createdAt: new Date(),
        orderId: 'ord-1',
      },
    ]);

    documentCount.mockResolvedValue(1);

    const res = await GET(new Request('http://localhost/api/documents'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string }[]; total: number };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].id).toBe('d1');
    // `С-8` (хотфикс №18): рядом со срезом идёт полный счётчик по тому же условию.
    expect(body.total).toBe(1);
  });

  it('срез ограничен пределом, счётчик считает по тому же условию', async () => {
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    documentFindMany.mockResolvedValue([]);
    documentCount.mockResolvedValue(1234);

    await GET(new Request('http://localhost/api/documents'));

    const listArgs = documentFindMany.mock.calls[0][0];
    const countArgs = documentCount.mock.calls[0][0];
    expect(listArgs.take).toBe(DOCUMENTS_API_CAP);
    expect(countArgs.where).toEqual(listArgs.where);
  });

  it('фильтр по заказу уходит в базу, а не отбирается в браузере', async () => {
    // Хотфикс №18 (`С-8`): карточка заказа просила весь список платформы.
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    documentFindMany.mockResolvedValue([]);
    documentCount.mockResolvedValue(0);

    await GET(new Request('http://localhost/api/documents?orderId=ord-42'));

    expect(documentFindMany.mock.calls[0][0].where).toMatchObject({ orderId: 'ord-42' });
  });
});
