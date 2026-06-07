import { describe, it, expect, vi } from 'vitest';

const { core, notify, session } = vi.hoisted(() => ({
  core: vi.fn(), notify: vi.fn(),
  session: { sub: 'pu1', role: 'partner', partnerId: 'p1', email: 'p@x.ru', name: 'P' }
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({ notifyManagers: notify }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn().mockResolvedValue(session) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: {
  order: { findUnique: vi.fn() },
  partner: { findUnique: vi.fn() }
} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { uploadPartnerDocument } from '@/server-actions/partner/documents';

const fd = (e: Record<string, string | File>) => { const f = new FormData(); for (const [k, v] of Object.entries(e)) f.set(k, v); return f; };
const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

describe('uploadPartnerDocument', () => {
  it('rejects an order that is not the partner\'s', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'OTHER', orderNumber: '1', title: 'T' });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('persists incoming partner-channel doc + notifies managers', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', partnerId: 'p1', orderNumber: '1', title: 'T' });
    db.partner.findUnique.mockResolvedValue({ name: 'ООО Партнёр' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await uploadPartnerDocument(fd({ orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'partner', id: 'p1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_partner');
  });
});
