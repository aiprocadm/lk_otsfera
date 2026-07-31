import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireSession, requireRole, documentFindMany } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
  documentFindMany: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({ requireSession, requireRole }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { document: { findMany: documentFindMany } },
}));
vi.mock('@/lib/services/scan/visibility', () => ({
  hideInfectedForSession: vi.fn(() => ({})),
}));

import { GET } from '@/app/api/documents/route';

const adminSession = { sub: 'u-admin', role: 'admin' as const };
const orgSession = { sub: 'u-org', role: 'organization' as const };

const unauthorizedResponse = Response.json({ error: 'Unauthorized' }, { status: 401 });
const forbiddenResponse = Response.json({ error: 'Forbidden' }, { status: 403 });

describe('GET /api/documents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    documentFindMany.mockResolvedValue([]);
  });

  it('401 when requireSession fails', async () => {
    requireSession.mockResolvedValue({ ok: false, response: unauthorizedResponse });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(documentFindMany).not.toHaveBeenCalled();
  });

  it('403 when role is not admin', async () => {
    requireSession.mockResolvedValue({ ok: true, value: orgSession });
    requireRole.mockReturnValue({ ok: false, response: forbiddenResponse });
    const res = await GET();
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

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string }[];
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('d1');
  });
});
