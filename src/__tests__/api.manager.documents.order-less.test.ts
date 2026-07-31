import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager, createManagerOrderLessDocument } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  createManagerOrderLessDocument: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/uploads', () => ({ createManagerOrderLessDocument }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/manager/documents/order-less/route';

function form(fields: Record<string, string>, withFile = true) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (withFile)
    fd.set(
      'file',
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'g.pdf', { type: 'application/pdf' })
    );
  return { formData: async () => fd } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'co-1' });
  // Route is gated by the opt-in manager_cabinet flag (3-point contract, §5).
  process.env.FEATURE_MANAGER_CABINET = '1';
});

describe('POST /api/manager/documents/order-less', () => {
  it('404 when manager_cabinet flag is disabled', async () => {
    process.env.FEATURE_MANAGER_CABINET = '0';
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' })
    );
    expect(res.status).toBe(404);
    delete process.env.FEATURE_MANAGER_CABINET;
  });

  it('maps forbidden → 403', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(403);
  });

  it('maps not_found → 404', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'not_found' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(404);
  });

  it('maps invalid_recipient → 422', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'invalid_recipient' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(422);
  });

  it('maps too_large → 413', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'too_large' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(413);
  });

  it('maps invalid_mime → 415', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(415);
  });

  it('maps storage → 502', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'storage' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(502);
  });

  it('maps unknown error code → 400 (fallback)', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'unknown_error' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' })
    );
    expect(res.status).toBe(400);
  });

  it('200 with documentId on success', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentId: 'd1' });
  });

  it('200 with partner counterpartyType', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: true, documentId: 'd2' });
    const res = await POST(
      form({ counterpartyType: 'partner', counterpartyId: 'p1', docType: 'other' })
    );
    expect(res.status).toBe(200);
  });

  it('400 on missing counterpartyId (empty string)', async () => {
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: '', docType: 'other' })
    );
    expect(res.status).toBe(400);
  });

  it('400 on missing file', async () => {
    const res = await POST(
      form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' }, false)
    );
    expect(res.status).toBe(400);
  });

  it('400 on invalid counterpartyType', async () => {
    const res = await POST(
      form({ counterpartyType: 'bogus', counterpartyId: 'o1', docType: 'other' })
    );
    expect(res.status).toBe(400);
  });

  it('400 when formData() fails (catch branch)', async () => {
    const badReq = {
      formData: async () => {
        throw new Error('parse failed');
      },
    } as unknown as Request;
    const res = await POST(badReq);
    expect(res.status).toBe(400);
  });

  it('400 when counterpartyType key is absent (null → ?? "" fallback)', async () => {
    // fd.get('counterpartyType') returns null → String(null ?? '') = '' → invalid → 400
    const res = await POST(form({ counterpartyId: 'o1', docType: 'other' }));
    expect(res.status).toBe(400);
  });

  it('400 when counterpartyId key is absent (null → ?? "" fallback)', async () => {
    // fd.get('counterpartyId') returns null → String(null ?? '') = '' → !counterpartyId → 400
    const res = await POST(form({ counterpartyType: 'organization', docType: 'other' }));
    expect(res.status).toBe(400);
  });

  it('success when docType key is absent (null → ?? "other" fallback)', async () => {
    // fd.get('docType') returns null → String(null ?? 'other') = 'other' → valid
    createManagerOrderLessDocument.mockResolvedValue({ ok: true, documentId: 'd3' });
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'o1' }));
    expect(res.status).toBe(200);
  });
});
