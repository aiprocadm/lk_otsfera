import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireManager, createManagerOrderLessDocument } = vi.hoisted(() => ({
  requireManager: vi.fn(),
  createManagerOrderLessDocument: vi.fn()
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireManager }));
vi.mock('@/lib/services/manager/uploads', () => ({ createManagerOrderLessDocument }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { POST } from '@/app/api/manager/documents/order-less/route';

function form(fields: Record<string, string>, withFile = true) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (withFile) fd.set('file', new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'g.pdf', { type: 'application/pdf' }));
  return { formData: async () => fd } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireManager.mockResolvedValue({ sub: 'm1', role: 'manager', companyId: 'co-1' });
  // Route is gated by the opt-in manager_cabinet flag (3-point contract, §5).
  process.env.FEATURE_MANAGER_CABINET = '1';
});

describe('POST /api/manager/documents/order-less', () => {
  it('maps forbidden → 403', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: false, error: 'forbidden' });
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'oX', docType: 'other' }));
    expect(res.status).toBe(403);
  });
  it('200 with documentId on success', async () => {
    createManagerOrderLessDocument.mockResolvedValue({ ok: true, documentId: 'd1' });
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ documentId: 'd1' });
  });
  it('400 on missing file', async () => {
    const res = await POST(form({ counterpartyType: 'organization', counterpartyId: 'o1', docType: 'other' }, false));
    expect(res.status).toBe(400);
  });
  it('400 on invalid counterpartyType', async () => {
    const res = await POST(form({ counterpartyType: 'bogus', counterpartyId: 'o1', docType: 'other' }));
    expect(res.status).toBe(400);
  });
});
