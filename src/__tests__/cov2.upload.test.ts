import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Coverage top-up for src/app/api/documents/upload/route.ts:150-166 — the
// notification fan-out try-block SUCCESS completion. cov.api-misc.test.ts §F
// already exercises the CATCH edge (notify resolves, deliver throws → line
// 167-173). This file drives the complementary path: BOTH recordNotification
// AND deliverNotificationToUser resolve without throwing, so the try completes
// normally (no catch) and the route returns the 200 success payload.
//
// Pure mock unit test (no PrismaClient) — mirrors the mock style of §F: the
// prisma singleton, storage, queue, notifications barrel, and auth guards are
// all hoisted-mocked so no external system is touched.
// ─────────────────────────────────────────────────────────────────────────────

const { requireSession, requireRole } = vi.hoisted(() => ({
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
const {
  orderFindUnique,
  orgFindFirst,
  docCreate,
  auditCreate,
  upload,
  enqueueAdd,
  recordNotification,
  deliverNotificationToUser,
  getPrimaryOrganizationId,
} = vi.hoisted(() => ({
  orderFindUnique: vi.fn(),
  orgFindFirst: vi.fn(),
  docCreate: vi.fn(),
  auditCreate: vi.fn(),
  upload: vi.fn(),
  enqueueAdd: vi.fn(),
  recordNotification: vi.fn(),
  deliverNotificationToUser: vi.fn(),
  getPrimaryOrganizationId: vi.fn(),
}));

vi.mock('@/lib/auth/guard', () => ({
  requireSession,
  requireRole,
  forbiddenResponse: () => Response.json({ error: 'Forbidden' }, { status: 403 }),
}));
vi.mock('@/lib/auth/organization', () => ({ getPrimaryOrganizationId }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    order: { findUnique: orderFindUnique },
    organization: { findFirst: orgFindFirst },
    document: { create: docCreate },
    auditLog: { create: auditCreate },
  },
}));
vi.mock('@/lib/notifications', () => ({ recordNotification, deliverNotificationToUser }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({
    upload,
    createSignedUrl: vi.fn(),
    remove: vi.fn(),
    download: vi.fn(),
  }),
}));
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: () => ({ add: enqueueAdd }),
  QUEUE_NAMES: ['docs.scanDocument'],
}));

import { POST as uploadPost } from '@/app/api/documents/upload/route';

const adminSession = { sub: 'admin-1', role: 'admin', partnerId: null } as never;

describe('documents/upload fan-out: try completes normally (route.ts:150-166)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSession.mockResolvedValue({ ok: true, value: adminSession });
    requireRole.mockReturnValue({ ok: true, value: adminSession });
    orderFindUnique.mockResolvedValue({ id: 'ord1', companyId: 'c1', organizationId: 'o1' });
    orgFindFirst.mockResolvedValue({ id: 'o1', partnerId: 'p1' });
    upload.mockResolvedValue(undefined);
    enqueueAdd.mockResolvedValue(undefined);
    docCreate.mockResolvedValue({
      id: 'd1',
      name: 'good.pdf',
      mimeType: 'application/pdf',
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    });
    auditCreate.mockResolvedValue({});
    getPrimaryOrganizationId.mockResolvedValue('o1');
    // notify SUCCEEDS → returns a row whose id feeds dedupKey (line 165)
    recordNotification.mockResolvedValue({ row: { id: 'notif-row-1' }, deduped: false });
    // deliver SUCCEEDS → try completes without entering the catch (line 166)
    deliverNotificationToUser.mockResolvedValue({ delivered: [], skipped: [] });
  });

  it('returns 200 with the created-doc payload when both notify and deliver resolve', async () => {
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));

    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      mimeType: string;
      createdAt: string;
    };
    expect(body).toMatchObject({ id: 'd1', name: 'good.pdf', mimeType: 'application/pdf' });

    // Both fan-out calls ran and resolved (no catch): notify first, deliver with
    // the row id threaded through as dedupKey.
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(recordNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'admin-1',
        organizationId: 'o1',
        type: 'document_created',
        title: 'Новый документ',
        meta: expect.objectContaining({ orderId: 'ord1', documentId: 'd1' }),
        // Ключ дедупа — документ.
        entityId: 'd1',
      })
    );
    expect(deliverNotificationToUser).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        type: 'document_created',
        meta: expect.objectContaining({ orderId: 'ord1', documentId: 'd1' }),
        dedupKey: 'notif-row-1',
      })
    );
  });

  it('повтор за час (deduped: true) — доставка не зовётся, ответ 200', async () => {
    recordNotification.mockResolvedValueOnce({ row: { id: 'notif-row-1' }, deduped: true });
    const fd = new FormData();
    fd.set('orderId', 'ord1');
    fd.set('file', new File(['%PDF-1.4 minimal'], 'good.pdf', { type: 'application/pdf' }));

    const res = await uploadPost(
      new Request('https://app.local/api/documents/upload', { method: 'POST', body: fd })
    );

    expect(res.status).toBe(200);
    expect(recordNotification).toHaveBeenCalledTimes(1);
    expect(deliverNotificationToUser).not.toHaveBeenCalled();
  });
});
