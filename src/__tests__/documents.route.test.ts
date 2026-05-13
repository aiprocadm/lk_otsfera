import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const auditCreate = vi.fn();
const canReadOrder = vi.fn();
const canReadDocument = vi.fn();
const upload = vi.fn();
const createSignedUrl = vi.fn();

vi.mock('@/lib/auth/session', () => ({ getSession }));
vi.mock('@/lib/db/prisma', () => ({ prisma: { order: { findUnique }, organization: { findFirst: vi.fn().mockResolvedValue({ id: 'o1', partnerId: 'p1' }) }, document: { create, findUnique: vi.fn() }, auditLog: { create: auditCreate } } }));
vi.mock('@/lib/auth/policy', () => ({ canReadOrder, canReadDocument, forbiddenResponse: (m: string) => Response.json({ message: m }, { status: 403 }) }));
vi.mock('@/lib/storage/supabase', () => ({ documentBucket: 'docs', supabaseAdmin: { storage: { from: () => ({ upload, createSignedUrl }) } } }));
vi.mock('@/lib/notifications', () => ({ notifyDocumentCreated: vi.fn(), triggerNotificationEmail: vi.fn() }));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId: vi.fn().mockResolvedValue('o1') }));

import { POST as uploadPost } from '@/app/api/documents/upload/route';
import { POST as downloadPost } from '@/app/api/documents/[id]/download/route';

describe('documents guards', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue({ role: 'admin', sub: 'u1', partnerId: 'p1' });
    findUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1' });
    canReadOrder.mockResolvedValue(true);
    upload.mockResolvedValue({ error: null });
    create.mockResolvedValue({ id: 'd1', name: 'x.pdf', mimeType: 'application/pdf', createdAt: new Date() });
  });

  it('validates MIME and size', async () => {
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['abc'], 'virus.exe', { type: 'application/octet-stream' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(400);
  });

  it('denies upload for foreign order', async () => {
    canReadOrder.mockResolvedValue(false);
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['ok'], 'doc.pdf', { type: 'application/pdf' }));
    const res = await uploadPost(new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd }));
    expect(res.status).toBe(403);
  });

  it('denies read for foreign document', async () => {
    const docFind = (await import('@/lib/db/prisma')).prisma.document.findUnique as any;
    docFind.mockResolvedValue({ id: 'd1', path: 'x', name: 'x.pdf', order: { companyId: 'c1' } });
    canReadDocument.mockResolvedValue(false);
    const res = await downloadPost(new Request('https://app.local/api/documents/d1/download', { method: 'POST' }), { params: { id: 'd1' } });
    expect(res.status).toBe(403);
  });
});
