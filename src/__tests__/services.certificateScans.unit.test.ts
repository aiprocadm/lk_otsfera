import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Этап 12 PR-2 (Модуль 5, ФТ-5.3) — сервис массовой загрузки сканов:
 * скоуп C8, принадлежность позиции заказу, пофайловая деградация, аудит связи.
 */

const { canSeeOrder, getCompanyTeamVisibility } = vi.hoisted(() => ({
  canSeeOrder: vi.fn(),
  getCompanyTeamVisibility: vi.fn()
}));
vi.mock('@/lib/auth/managerPolicy', () => ({ canSeeOrder, getCompanyTeamVisibility }));

const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { persistUploadedDocument } = vi.hoisted(() => ({ persistUploadedDocument: vi.fn() }));
vi.mock('@/lib/services/documents/upload-core', () => ({ persistUploadedDocument }));

import {
  listCertificateScanTargets,
  uploadCertificateScans
} from '@/lib/services/manager/certificateScans';
import type { SessionPayload } from '@/lib/auth/jwt';

const session = { sub: 'm1', role: 'manager', companyId: 'co-1' } as unknown as SessionPayload;

const ORDER = {
  id: 'o1',
  managerId: 'm1',
  organizationId: 'org-1',
  partnerId: null,
  companyId: 'co-1',
  serviceType: 'training',
  items: [
    {
      id: 'i1',
      student: { name: 'Иванов Иван' },
      certificate: { id: 'c1', number: 'АБ-1', documentId: null }
    },
    {
      id: 'i2',
      student: { name: 'Петрова Анна' },
      certificate: null
    }
  ]
};

function makePrisma(order: unknown) {
  const certificateUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(order) },
    certificate: { update: certificateUpdate }
  } as never;
  return { prisma, certificateUpdate };
}

function file(name: string) {
  return { name, size: 10, mimeType: 'application/pdf', buffer: Buffer.from('x') };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrder.mockReturnValue(true);
  persistUploadedDocument.mockResolvedValue({ ok: true, documentId: 'doc-new' });
});

describe('listCertificateScanTargets', () => {
  it('отдаёт позиции с ФИО, номером и признаком «скан уже есть»', async () => {
    const { prisma } = makePrisma({
      ...ORDER,
      items: [
        { id: 'i1', student: { name: 'Иванов' }, certificate: { id: 'c1', number: 'АБ-1', documentId: 'd1' } }
      ]
    });
    const res = await listCertificateScanTargets(prisma, session, 'o1');
    expect(res).toEqual({
      ok: true,
      targets: [
        {
          itemId: 'i1',
          studentName: 'Иванов',
          certificateId: 'c1',
          certificateNumber: 'АБ-1',
          hasScan: true
        }
      ]
    });
  });

  it('позиция без удостоверения отдаётся с пустыми полями', async () => {
    const { prisma } = makePrisma(ORDER);
    const res = await listCertificateScanTargets(prisma, session, 'o1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.targets[1]).toEqual({
        itemId: 'i2',
        studentName: 'Петрова Анна',
        certificateId: null,
        certificateNumber: null,
        hasScan: false
      });
    }
  });

  it('вне скоупа → forbidden; несуществующий заказ → not_found', async () => {
    canSeeOrder.mockReturnValue(false);
    const a = makePrisma(ORDER);
    expect(await listCertificateScanTargets(a.prisma, session, 'o1')).toEqual({
      ok: false,
      error: 'forbidden'
    });
    const b = makePrisma(null);
    expect(await listCertificateScanTargets(b.prisma, session, 'x')).toEqual({
      ok: false,
      error: 'not_found'
    });
  });
});

describe('uploadCertificateScans', () => {
  it('пустой список файлов → validation', async () => {
    const { prisma } = makePrisma(ORDER);
    expect(await uploadCertificateScans(prisma, session, { orderId: 'o1', files: [] })).toEqual({
      ok: false,
      error: 'validation'
    });
  });

  it('несуществующий заказ → not_found', async () => {
    const { prisma } = makePrisma(null);
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'x',
      files: [{ orderItemId: 'i1', file: file('a.pdf') }]
    });
    expect(res).toEqual({ ok: false, error: 'not_found' });
  });

  it('заказ вне скоупа → forbidden, ничего не грузится', async () => {
    canSeeOrder.mockReturnValue(false);
    const { prisma, certificateUpdate } = makePrisma(ORDER);
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [{ orderItemId: 'i1', file: file('a.pdf') }]
    });
    expect(res).toEqual({ ok: false, error: 'forbidden' });
    expect(persistUploadedDocument).not.toHaveBeenCalled();
    expect(certificateUpdate).not.toHaveBeenCalled();
  });

  it('успех: файл сохранён, удостоверение связано, аудит записан', async () => {
    const { prisma, certificateUpdate } = makePrisma(ORDER);
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [{ orderItemId: 'i1', file: file('Иванов.pdf') }]
    });
    expect(res).toEqual({
      ok: true,
      results: [{ fileName: 'Иванов.pdf', ok: true, orderItemId: 'i1', documentId: 'doc-new' }]
    });
    expect(persistUploadedDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        counterparty: { type: 'organization', id: 'org-1' },
        orderId: 'o1',
        direction: 'outgoing',
        docType: 'certificate',
        uploadedById: 'm1'
      })
    );
    expect(certificateUpdate).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { documentId: 'doc-new' }
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'certificate_scan_attached',
        entity: 'certificate',
        entityId: 'c1'
      })
    );
  });

  it('замена скана: в аудите остаётся прежний документ', async () => {
    const { prisma } = makePrisma({
      ...ORDER,
      items: [
        { id: 'i1', student: { name: 'Иванов' }, certificate: { id: 'c1', number: 'АБ-1', documentId: 'old-doc' } }
      ]
    });
    await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [{ orderItemId: 'i1', file: file('new.pdf') }]
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        after: expect.objectContaining({ replacedDocumentId: 'old-doc', documentId: 'doc-new' })
      })
    );
  });

  it('позиция чужого заказа → item_not_found, остальные файлы грузятся', async () => {
    const { prisma, certificateUpdate } = makePrisma(ORDER);
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [
        { orderItemId: 'чужая', file: file('чужой.pdf') },
        { orderItemId: 'i1', file: file('Иванов.pdf') }
      ]
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.results[0]).toEqual({
        fileName: 'чужой.pdf',
        ok: false,
        orderItemId: 'чужая',
        error: 'item_not_found'
      });
      expect(res.results[1].ok).toBe(true);
    }
    expect(certificateUpdate).toHaveBeenCalledTimes(1);
  });

  it('позиция без удостоверения → certificate_missing', async () => {
    const { prisma, certificateUpdate } = makePrisma(ORDER);
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [{ orderItemId: 'i2', file: file('Петрова.pdf') }]
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.results[0]).toMatchObject({ ok: false, error: 'certificate_missing' });
    expect(persistUploadedDocument).not.toHaveBeenCalled();
    expect(certificateUpdate).not.toHaveBeenCalled();
  });

  it('отказ загрузки (тип файла) не связывает удостоверение и не валит пачку', async () => {
    persistUploadedDocument
      .mockResolvedValueOnce({ ok: false, error: 'invalid_mime' })
      .mockResolvedValueOnce({ ok: true, documentId: 'doc-2' });
    const { prisma, certificateUpdate } = makePrisma({
      ...ORDER,
      items: [
        { id: 'i1', student: { name: 'Иванов' }, certificate: { id: 'c1', number: 'АБ-1', documentId: null } },
        { id: 'i3', student: { name: 'Сидоров' }, certificate: { id: 'c3', number: 'АБ-3', documentId: null } }
      ]
    });
    const res = await uploadCertificateScans(prisma, session, {
      orderId: 'o1',
      files: [
        { orderItemId: 'i1', file: file('плохой.exe') },
        { orderItemId: 'i3', file: file('хороший.pdf') }
      ]
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.results[0]).toMatchObject({ ok: false, error: 'invalid_mime' });
      expect(res.results[1]).toMatchObject({ ok: true, documentId: 'doc-2' });
    }
    expect(certificateUpdate).toHaveBeenCalledTimes(1);
    expect(certificateUpdate).toHaveBeenCalledWith({
      where: { id: 'c3' },
      data: { documentId: 'doc-2' }
    });
  });
});
