import { describe, it, expect, vi } from 'vitest';

const { core, notify, session } = vi.hoisted(() => ({
  core: vi.fn(), notify: vi.fn(),
  session: { sub: 'u1', role: 'organization', email: 'o@x.ru', name: 'O' }
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({ notifyManagers: notify }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn().mockResolvedValue(session) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
const { db } = vi.hoisted(() => ({ db: {
  organizationUser: { findFirst: vi.fn() },
  order: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() }
} }));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));

import { uploadOrganizationDocument } from '@/server-actions/organization/documents';

function fd(entries: Record<string, string | File>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}
const file = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'a.pdf', { type: 'application/pdf' });

describe('uploadOrganizationDocument', () => {
  it('rejects when the user is not an active member of the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue(null);
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });

  it('rejects when the order is not in the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'OTHER', orderNumber: '1', title: 'T' });
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: false, error: 'not_found' });
  });

  it('persists incoming org-channel doc + notifies managers', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'org1', orderNumber: '1', title: 'T' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Клиент' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await uploadOrganizationDocument(fd({ organizationId: 'org1', orderId: 'o1', docType: 'act', file: file() }));
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'organization', id: 'org1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_org');
  });
});
