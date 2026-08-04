/**
 * Unit-тесты для src/lib/services/organization/documentUpload.ts.
 *
 * Ветки доступа и записи переехали сюда из server-action
 * `uploadOrganizationDocument` (аудит A1: прямых запросов Prisma в экшенах нет).
 * Ключевой инвариант изоляции: членство читается из БД по session.sub, а заказ
 * обязан принадлежать той же организации.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { core, notify, notifyOrderLess } = vi.hoisted(() => ({
  core: vi.fn(),
  notify: vi.fn(),
  notifyOrderLess: vi.fn(),
}));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument: core }));
vi.mock('@/lib/notifications', () => ({
  notifyManagers: notify,
  notifyManagersOrderLess: notifyOrderLess,
}));

import { createOrganizationDocument } from '@/lib/services/organization/documentUpload';
import type { SessionPayload } from '@/lib/auth/jwt';

const db = {
  organizationUser: { findFirst: vi.fn() },
  order: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
};
const prisma = db as never;

const orgSession: SessionPayload = {
  sub: 'u1',
  role: 'organization',
  email: 'o@x.ru',
  name: 'O',
};

const file = () => ({
  name: 'a.pdf',
  size: 4,
  mimeType: 'application/pdf',
  buffer: Buffer.from([0x25, 0x50, 0x44, 0x46]),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createOrganizationDocument — membership guard', () => {
  it('rejects when the user is not an active member of the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue(null);
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'forbidden' });
    expect(core).not.toHaveBeenCalled();
  });

  it('членство читается из БД по session.sub, а не по клеймам сессии', async () => {
    db.organizationUser.findFirst.mockResolvedValue(null);
    await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'act',
      file: file(),
    });
    expect(db.organizationUser.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org1', userId: 'u1', isActive: true },
      select: { id: true },
    });
  });
});

describe('createOrganizationDocument — order path', () => {
  it('rejects when the order is not in the org', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'OTHER',
      orderNumber: '1',
      title: 'T',
    });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('rejects when the order does not exist', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue(null);
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'gone',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns upload error from persistUploadedDocument (order path)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org1',
      orderNumber: '1',
      title: 'T',
    });
    core.mockResolvedValue({ ok: false, error: 'invalid_mime' });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'invalid_mime' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('persists incoming org-channel doc + notifies managers', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org1',
      orderNumber: '1',
      title: 'T',
    });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Клиент' });
    core.mockResolvedValue({ ok: true, documentId: 'doc1' });
    notify.mockResolvedValue({ recipientsNotified: 1 });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc1' });
    expect(core.mock.calls[0][1].counterparty).toEqual({ type: 'organization', id: 'org1' });
    expect(core.mock.calls[0][1].direction).toBe('incoming');
    expect(core.mock.calls[0][1].uploadedById).toBe('u1');
    expect(notify.mock.calls[0][1].type).toBe('document_uploaded_by_org');
  });

  it('uses "организация" fallback when org lookup returns null on order path', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org1',
      orderNumber: '1',
      title: 'T',
    });
    db.organization.findUnique.mockResolvedValue(null);
    core.mockResolvedValue({ ok: true, documentId: 'doc-null-org' });
    notify.mockResolvedValue({ recipientsNotified: 1 });

    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-null-org' });
    expect(notify.mock.calls[0][1].payload).toMatchObject({ orgName: 'организация' });
  });

  it('still returns ok:true when notifyManagers throws on order path (graceful degradation)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org1',
      orderNumber: '1',
      title: 'T',
    });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Клиент' });
    core.mockResolvedValue({ ok: true, documentId: 'doc-x' });
    notify.mockRejectedValue(new Error('notify pipeline down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-x' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still returns ok:true when notifyManagers throws a non-Error on order path (String(err) branch)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.order.findUnique.mockResolvedValue({
      id: 'o1',
      organizationId: 'org1',
      orderNumber: '1',
      title: 'T',
    });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Клиент' });
    core.mockResolvedValue({ ok: true, documentId: 'doc-str-err' });
    // Throw a plain string — covers `err instanceof Error ? err.message : String(err)` false branch
    notify.mockRejectedValue('string_error');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: 'o1',
      docType: 'act',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-str-err' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('createOrganizationDocument — order-less path', () => {
  it('returns not_found when org has no companyId (standalone-but-orphan)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Тест', companyId: null });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns not_found when org does not exist (null)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue(null);
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'not_found' });
    expect(core).not.toHaveBeenCalled();
  });

  it('returns upload error from persistUploadedDocument (order-less path)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Тест', companyId: 'co-1' });
    core.mockResolvedValue({ ok: false, error: 'too_large' });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: false, error: 'too_large' });
    expect(notifyOrderLess).not.toHaveBeenCalled();
  });

  it('order-less path: persists with orderId null + companyId and calls notifyManagersOrderLess', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Тест', companyId: 'co-1' });
    core.mockResolvedValue({ ok: true, documentId: 'doc2' });
    notifyOrderLess.mockResolvedValue({ recipientsNotified: 1, emailsSent: 0, emailsSkipped: 0 });
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc2' });
    expect(core.mock.calls[0][1]).toMatchObject({
      orderId: null,
      companyId: 'co-1',
      direction: 'incoming',
    });
    expect(notifyOrderLess).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org1',
        orgName: 'ООО Тест',
        documentName: 'a.pdf',
        documentType: 'contract',
      })
    );
  });

  it('still returns ok:true when notifyManagersOrderLess throws (graceful degradation)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Тест', companyId: 'co-1' });
    core.mockResolvedValue({ ok: true, documentId: 'doc3' });
    notifyOrderLess.mockRejectedValue(new Error('notify down'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc3' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('still returns ok:true when notifyManagersOrderLess throws a non-Error (String(err) branch)', async () => {
    db.organizationUser.findFirst.mockResolvedValue({ id: 'ou1' });
    db.organization.findUnique.mockResolvedValue({ name: 'ООО Тест', companyId: 'co-1' });
    core.mockResolvedValue({ ok: true, documentId: 'doc4' });
    // Throw a plain string — covers the `err instanceof Error ? ... : String(err)` false branch
    notifyOrderLess.mockRejectedValue('string_error');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await createOrganizationDocument(prisma, orgSession, {
      organizationId: 'org1',
      orderId: null,
      docType: 'contract',
      file: file(),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc4' });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
