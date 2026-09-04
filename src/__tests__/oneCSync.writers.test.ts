import { describe, it, expect, vi, beforeEach } from 'vitest';
const { resolveOrganizationRef } = vi.hoisted(() => ({ resolveOrganizationRef: vi.fn() }));
const { notifyOrgUsers, notifyManagers } = vi.hoisted(() => ({
  notifyOrgUsers: vi.fn(),
  notifyManagers: vi.fn(),
}));
const { fetchAndStore1CDocument } = vi.hoisted(() => ({ fetchAndStore1CDocument: vi.fn() }));
const { getQueue } = vi.hoisted(() => ({ getQueue: vi.fn() }));
const { setDocumentStatus } = vi.hoisted(() => ({ setDocumentStatus: vi.fn() }));
vi.mock('@/lib/services/oneCSync/resolve-org', () => ({ resolveOrganizationRef }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers, notifyManagers }));
vi.mock('@/lib/services/oneCSync/document-fetch', () => ({ fetchAndStore1CDocument }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));

import {
  upsertOrderRecord,
  upsertPaymentRecord,
  upsertOrgRecord,
  upsertDocumentRecord,
} from '@/lib/services/oneCSync/writers';
import { emptySummary } from '@/lib/services/oneCSync/record-batch';

const baseDto = {
  externalId: 'O1',
  orderNumber: 'O1',
  title: 'Order 1',
  organizationExternalId: 'E-ORG',
  totalAmount: 100,
  paidAmount: 100,
  vatIncluded: true,
  executionStatus: 'pending',
  financialStatus: 'paid',
  productMix: [],
  updatedAt: '2026-04-01T00:00:00Z',
} as any;

function db() {
  return {
    order: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      update: vi.fn(),
    },
    // B4: resolveAutoManager runs for real; default = no attachment → managerId stays null.
    organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
  } as any;
}
beforeEach(() => {
  resolveOrganizationRef.mockReset();
  notifyOrgUsers.mockReset();
  notifyManagers.mockReset();
  fetchAndStore1CDocument.mockReset();
  fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
  getQueue.mockReset();
  getQueue.mockReturnValue({ add: vi.fn() });
});

describe('upsertOrderRecord', () => {
  it('creates a new order with financialStatus/partnerId/companyId in live mode', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: 'p',
      externalId: 'E-ORG',
    });
    const d = db();
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: true });
    expect(d.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'O1',
        financialStatus: 'paid',
        executionStatus: 'pending',
        partnerId: 'p',
        companyId: 'c',
        organizationId: 'o',
      }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  it('shadow mode counts but does not write', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = db();
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'shadow', notify: true });
    expect(d.order.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  it('B4: auto-assigns the org’s single attached manager on create', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = db();
    d.organizationManager.findMany.mockResolvedValue([{ userId: 'mgr-auto' }]);
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false });
    expect(d.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ managerId: 'mgr-auto' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  it('B4: swallows a resolver failure on create (best-effort, order still created)', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = db();
    d.organizationManager.findMany.mockRejectedValue(new Error('db blip'));
    const sum = emptySummary();
    await expect(
      upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false })
    ).resolves.not.toThrow();
    const data = d.order.create.mock.calls[0][0].data;
    expect('managerId' in data).toBe(false);
    expect(sum.created).toBe(1);
  });
  it('skips out-of-scope org for scoped manager', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = db();
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, {
      mode: 'live',
      notify: false,
      scope: { kind: 'orgs', allowedOrgIds: ['other'] },
    });
    expect(d.order.create).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });
  it('skips when org not found', async () => {
    resolveOrganizationRef.mockResolvedValue(null);
    const d = db();
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: true });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'organization_not_found' });
  });
  it('resolves org by INN when organizationExternalId is absent', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'X',
    });
    const d = db();
    const sum = emptySummary();
    const innDto = {
      externalId: 'O-INN',
      title: 't',
      organizationInn: '7700',
      totalAmount: 100,
      paidAmount: 100,
      vatIncluded: true,
      executionStatus: 'pending',
      financialStatus: 'paid',
      productMix: [],
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    await upsertOrderRecord(d, innDto, sum, { mode: 'live', notify: false });
    // Третий аргумент — canWrite (Т-24): live-режим разрешает backfill.
    expect(resolveOrganizationRef).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ inn: '7700' }),
      true
    );
    expect(sum.created).toBe(1);
  });
  it('notify=false suppresses status-change notification on update', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = db();
    d.order.findUnique.mockResolvedValue({
      id: 'ex',
      organizationId: 'o',
      financialStatus: 'billed',
      orderNumber: 'O1',
      title: 'Order 1',
    });
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false });
    expect(d.order.update).toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });
});

describe('upsertOrgRecord', () => {
  const orgDto = {
    externalId: 'ORG-1',
    name: 'Acme',
    inn: '77',
    kpp: '01',
    partnerExternalId: 'acme-partner',
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;
  function odb(over = {}) {
    return {
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
      ...over,
    } as any;
  }
  // Этап 6 (Т-41): Company больше не минтится — организация создаётся в
  // переданной компании одним organization.create, без транзакции.
  it('создаёт организацию в переданной компании (live, Т-41)', async () => {
    const d = odb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false, createCompanyId: 'co1' });
    expect(d.organization.create).toHaveBeenCalledWith({
      // `У-84`: создание из 1С-синка тоже пишет ключ названия.
      data: expect.objectContaining({ companyId: 'co1', partnerId: 'p1', nameKey: 'ACME' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  it('нет ни скоупа company, ни createCompanyId → failed: company_not_configured', async () => {
    const d = odb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false });
    expect(sum.failed).toBe(1);
    expect(sum.failures[0]).toMatchObject({
      externalId: 'ORG-1',
      error: 'company_not_configured',
    });
    expect(d.organization.create).not.toHaveBeenCalled();
  });
  it('скоуп company побеждает createCompanyId — руководитель создаёт строго в своей (C8)', async () => {
    const d = odb();
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, {
      mode: 'live',
      notify: false,
      scope: { kind: 'company', companyId: 'co-own' },
      createCompanyId: 'co-foreign',
    });
    expect(d.organization.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ companyId: 'co-own' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  it('skips when partner not found', async () => {
    const d = odb({ partner: { findFirst: vi.fn().mockResolvedValue(null) } });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'partner_not_found' });
    expect(d.organization.create).not.toHaveBeenCalled();
  });
  it('updates existing org (live), shadow writes nothing', async () => {
    const d = odb({
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', companyId: 'co1' }),
        update: vi.fn(),
      },
    });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false });
    expect(d.organization.update).toHaveBeenCalled();
    expect(sum.updated).toBe(1);
    const d2 = odb({
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', companyId: 'co1' }),
        update: vi.fn(),
      },
    });
    const sum2 = emptySummary();
    await upsertOrgRecord(d2, orgDto, sum2, { mode: 'shadow', notify: false });
    expect(d2.organization.update).not.toHaveBeenCalled();
    expect(sum2.updated).toBe(1);
  });

  // Data-integrity: an org may already exist by INN (created via xlsx import or
  // backfilled from an order) with no/other externalId. Resolving by externalId
  // ONLY would miss it and the create branch would throw P2002 on inn @unique every
  // run. upsertOrgRecord must resolve by externalId OR inn, mirroring the order/payment
  // writers, and update-in-place (backfilling externalId only when absent).
  it('resolves an existing org by INN when externalId misses — updates in place, backfills externalId, no create', async () => {
    const d = odb({
      organization: {
        findUnique: vi.fn().mockResolvedValue(null), // no externalId match
        findFirst: vi.fn().mockResolvedValue({ id: 'o-inn', companyId: 'co1', externalId: null }), // INN match, no externalId yet
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
    });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false });
    expect(d.organization.create).not.toHaveBeenCalled();
    expect(d.organization.update).toHaveBeenCalledWith({
      where: { id: 'o-inn' },
      // `У-84`: 1С-синк при обновлении имени пересчитывает ключ названия.
      data: expect.objectContaining({
        externalId: 'ORG-1',
        inn: '77',
        name: 'Acme',
        nameKey: 'ACME',
      }),
    });
    expect(sum.updated).toBe(1);
    expect(sum.created).toBe(0);
  });

  it('does not overwrite an existing different externalId on an INN match (preserves 1C identity)', async () => {
    const d = odb({
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'o-inn', companyId: 'co1', externalId: 'E-OLD' }), // already has an externalId
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
    });
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false });
    expect(d.organization.create).not.toHaveBeenCalled();
    const data = d.organization.update.mock.calls[0][0].data;
    expect('externalId' in data).toBe(false); // preserve E-OLD, never clobber
    expect(data).toMatchObject({ inn: '77', name: 'Acme', nameKey: 'ACME' });
    expect(sum.updated).toBe(1);
  });

  describe('У-171 (Д-23): реквизиты контрагента — пустое из 1С не затирает заполненное', () => {
    const REQ = {
      inn: '7701234567',
      kpp: '770101001',
      legalName: 'Общество с ограниченной ответственностью «Acme»',
      ogrn: '1027700000001',
      legalAddress: '101000, г. Москва, ул. Первая, д. 1',
      bankName: 'ПАО Банк',
      bankAccount: '40702810000000000001',
      corrAccount: '30101810000000000001',
      bic: '044525001',
      signerName: 'Иванов И. И.',
      signerPosition: 'Генеральный директор',
      signerBasis: 'Устава',
    };
    const KEYS = Object.keys(REQ);
    const dto = (over: Record<string, unknown> = {}) =>
      ({
        externalId: 'ORG-1',
        name: 'Acme',
        updatedAt: '2026-04-01T00:00:00Z',
        ...over,
      }) as any;
    const existing = () =>
      odb({
        organization: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ id: 'o1', companyId: 'co1', externalId: 'ORG-1' }),
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        },
      });

    it('обновление: все двенадцать непустых реквизитов ложатся в update', async () => {
      const d = existing();
      await upsertOrgRecord(d, dto(REQ), emptySummary(), { mode: 'live', notify: false });
      expect(d.organization.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { name: 'Acme', nameKey: 'ACME', ...REQ },
      });
    });

    it('обновление: реквизита нет в DTO — ключа нет в update (менеджерский адрес остаётся)', async () => {
      const d = existing();
      await upsertOrgRecord(d, dto(), emptySummary(), { mode: 'live', notify: false });
      const data = d.organization.update.mock.calls[0][0].data;
      for (const key of KEYS) expect(key in data, key).toBe(false);
      expect(data).toEqual({ name: 'Acme', nameKey: 'ACME' });
    });

    it('обновление: пустая строка и пробелы из 1С — тоже «нет», а не «стереть»', async () => {
      const d = existing();
      await upsertOrgRecord(
        d,
        dto({ legalAddress: '', bankName: '   ', kpp: '\t', legalName: 'ООО «Acme»' }),
        emptySummary(),
        { mode: 'live', notify: false }
      );
      const data = d.organization.update.mock.calls[0][0].data;
      expect('legalAddress' in data).toBe(false);
      expect('bankName' in data).toBe(false);
      expect('kpp' in data).toBe(false);
      expect(data.legalName).toBe('ООО «Acme»');
    });

    it('создание: реквизиты пишутся как есть — заполненные значением, отсутствующие null', async () => {
      const d = odb();
      await upsertOrgRecord(d, dto({ legalName: 'ООО «Acme»', bic: '044525001' }), emptySummary(), {
        mode: 'live',
        notify: false,
        createCompanyId: 'co1',
      });
      const data = d.organization.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ legalName: 'ООО «Acme»', bic: '044525001' });
      for (const key of KEYS.filter((k) => k !== 'legalName' && k !== 'bic')) {
        expect(data[key], key).toBeNull();
      }
    });

    it('снимок «до» для истории импорта не расширяется: список Т-33 прежний', async () => {
      const d = existing();
      const out = await upsertOrgRecord(d, dto(REQ), emptySummary(), {
        mode: 'live',
        notify: false,
      });
      expect(out).toMatchObject({ action: 'updated', entityId: 'o1' });
      expect(Object.keys(out!.before!).sort()).toEqual(
        ['externalId', 'inn', 'kpp', 'name', 'partnerId'].sort()
      );
    });
  });
});

describe('upsertDocumentRecord', () => {
  const docDto = {
    externalId: 'D-1',
    orderExternalId: 'O-1',
    direction: 'incoming',
    type: 'contract',
    name: 'Договор',
    mimeType: 'application/pdf',
    size: 10,
    downloadUrl: 'https://1c/d1',
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;
  /** `У-170`: найденный документ отдаёт поля сверки файла и подписи. */
  const existingDoc = (over: Record<string, unknown> = {}) => ({
    id: 'ex',
    externalId: 'D-1',
    type: 'contract',
    status: 'issued',
    number: null,
    version: 1,
    mimeType: 'application/pdf',
    size: 10,
    signedAt: null,
    uploadedById: null,
    sentById: null,
    ...over,
  });
  function ddb(over = {}) {
    return {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: 'o1', orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
      ...over,
    } as any;
  }
  it('creates a document for a found order and notifies when notify:true', async () => {
    const d = ddb();
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true });
    expect(d.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalId: 'D-1',
        orderId: 'ord1',
        counterpartyType: 'organization',
        counterpartyId: 'o1',
        direction: 'incoming',
        generatedBy: 'system',
      }),
      select: { id: true },
    });
    expect(notifyOrgUsers).toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  // DOC-03: the 1C file is fetched and stored in object storage (S3); path is a storage key,
  // never the external URL (download routes assume a bucket key).
  it('fetches+stores the 1C file and writes a storage key as path (DOC-03)', async () => {
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-Договор.pdf');
    const d = ddb();
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false });
    expect(fetchAndStore1CDocument).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://1c/d1', orderId: 'ord1' })
    );
    const data = d.document.create.mock.calls[0][0].data;
    expect(data.path).toBe('orders/ord1/1c/uuid-Договор.pdf');
    expect(data.path).not.toContain('https://');
    expect(data.scanStatus).toBe('pending');
  });
  it('enqueues a ClamAV scan for the stored 1C document', async () => {
    const prev = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://test'; // enqueue is gated on Redis presence
    try {
      const addMock = vi.fn();
      getQueue.mockReturnValue({ add: addMock });
      const d = ddb({
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'doc9' }),
          update: vi.fn(),
        },
      });
      await upsertDocumentRecord(d, docDto, emptySummary(), { mode: 'live', notify: false });
      expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
      expect(addMock).toHaveBeenCalledWith(
        'scan',
        expect.objectContaining({ kind: 'document', id: 'doc9' })
      );
    } finally {
      if (prev === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prev;
    }
  });
  it('skips with document_fetch_failed when the 1C file cannot be stored', async () => {
    fetchAndStore1CDocument.mockResolvedValue(null);
    const d = ddb();
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true });
    expect(d.document.create).not.toHaveBeenCalled();
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'document_fetch_failed' });
  });
  it('shadow mode does not fetch or write but counts created', async () => {
    const d = ddb();
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'shadow', notify: false });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    expect(d.document.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
  it('update path: metadata only, keeps existing stored path, no re-fetch', async () => {
    const d = ddb({
      document: {
        findUnique: vi.fn().mockResolvedValue(existingDoc()),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    });
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    const updateData = d.document.update.mock.calls[0][0].data;
    expect('path' in updateData).toBe(false);
    expect(sum.updated).toBe(1);
  });
  it('skips when order not found', async () => {
    const d = ddb({ order: { findUnique: vi.fn().mockResolvedValue(null) } });
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'order_not_found' });
  });
  it('notify:false suppresses document_published', async () => {
    const d = ddb();
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });
});

describe('upsertPaymentRecord', () => {
  const payOrderDto = {
    externalId: 'P1',
    orderExternalId: 'O1',
    amount: 50,
    paidAt: '2026-04-01T00:00:00Z',
    isRefund: false,
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;
  const payOrgDto = {
    externalId: 'P2',
    organizationExternalId: 'E-ORG',
    amount: 50,
    paidAt: '2026-04-01T00:00:00Z',
    isRefund: false,
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;
  function pdb() {
    return {
      order: { findUnique: vi.fn() },
      payment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
  }

  it('links payment to order when orderExternalId present', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: false });
    expect(d.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: 'P1', orderId: 'ord', organizationId: 'o' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });

  it('persists purpose/paymentOrderNumber/vatAmount on create (§7.1)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    const richDto = {
      externalId: 'P-RICH',
      orderExternalId: 'O1',
      amount: 180,
      vatAmount: 30,
      purpose: 'Оплата по договору №5',
      paymentOrderNumber: 'ПП-007',
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    await upsertPaymentRecord(d, richDto, sum, { mode: 'live', notify: false });
    expect(d.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        purpose: 'Оплата по договору №5',
        paymentOrderNumber: 'ПП-007',
        vatAmount: 30,
        enteredById: null,
      }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });

  it('persists purpose/paymentOrderNumber/vatAmount on update (§7.1)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    d.payment.findUnique.mockResolvedValue({
      id: 'pay-existing',
      amount: 100,
      paidAt: new Date('2026-04-01T00:00:00Z'),
      purpose: null,
    });
    const sum = emptySummary();
    const richDto = {
      externalId: 'P-UPD',
      orderExternalId: 'O1',
      amount: 180,
      vatAmount: 30,
      purpose: 'Обновлённое назначение',
      paymentOrderNumber: 'ПП-008',
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    await upsertPaymentRecord(d, richDto, sum, { mode: 'live', notify: false });
    expect(d.payment.update).toHaveBeenCalledWith({
      where: { id: 'pay-existing' },
      data: expect.objectContaining({
        purpose: 'Обновлённое назначение',
        paymentOrderNumber: 'ПП-008',
        vatAmount: 30,
      }),
    });
    expect(sum.updated).toBe(1);
  });
  it('writes org-level payment when only organizationExternalId present', async () => {
    const d = pdb();
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, { mode: 'live', notify: false });
    expect(d.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: 'P2', orderId: null, organizationId: 'o' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  // `У-88`: локальная адресация организации по id ЛК доезжает до резолвера.
  it('передаёт organizationId в resolveOrganizationRef (организация без ИНН)', async () => {
    const d = pdb();
    resolveOrganizationRef.mockResolvedValue({
      id: 'org-local',
      companyId: 'c',
      partnerId: null,
      externalId: null,
    });
    const sum = emptySummary();
    const dto = {
      externalId: 'P3',
      organizationId: 'org-local',
      amount: 50,
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    await upsertPaymentRecord(d, dto, sum, { mode: 'live', notify: false });
    expect(resolveOrganizationRef).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ id: 'org-local' }),
      true
    );
    expect(d.payment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ externalId: 'P3', organizationId: 'org-local' }),
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });
  it('skips when order not found', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue(null);
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: false });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'order_not_found' });
  });

  it('skips order-linked payment that is out_of_scope', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      companyId: 'c',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, {
      mode: 'live',
      notify: false,
      scope: { kind: 'orgs', allowedOrgIds: ['other'] },
    });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('skips when org not found in org-level path', async () => {
    const d = pdb();
    resolveOrganizationRef.mockResolvedValue(null);
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, { mode: 'live', notify: false });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'organization_not_found' });
  });

  it('skips org-level payment that is out_of_scope', async () => {
    const d = pdb();
    resolveOrganizationRef.mockResolvedValue({
      id: 'o-other',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrgDto, sum, {
      mode: 'live',
      notify: false,
      scope: { kind: 'orgs', allowedOrgIds: ['different'] },
    });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'out_of_scope' });
  });

  it('skips when organizationId ends up null (payment without order or org)', async () => {
    // Path: orderExternalId absent, org found but resolves null organizationId
    // We test via the explicit null check at line 85 — org with id null is unreachable
    // via current TS, but we trigger it via the org-path where org.id is ''
    const payNullOrgDto = {
      externalId: 'P-NULL',
      organizationInn: '00',
      amount: 1,
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    const d = pdb();
    // resolveOrg returns an org with a falsy id — triggers organizationId === null path
    resolveOrganizationRef.mockResolvedValue({
      id: '',
      companyId: 'c',
      partnerId: null,
      externalId: null,
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payNullOrgDto, sum, { mode: 'live', notify: false });
    // '' is falsy: organizationId = '' → but the guard is (!organizationId) which is true for ''
    // So it skips with organization_not_found
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'organization_not_found' });
  });

  it('updates existing payment (live)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    d.payment.findUnique.mockResolvedValue({
      id: 'pay-existing',
      amount: 100,
      paidAt: new Date('2026-04-01T00:00:00Z'),
      purpose: null,
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: false });
    expect(d.payment.update).toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });

  it('shadow mode: counts created but does not write', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'shadow', notify: false });
    expect(d.payment.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });

  it('notifies org users and managers on new order-linked non-refund payment', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: true });
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ type: 'payment_received' })
    );
    expect(notifyManagers).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ type: 'order_marked_paid_by_1c' })
    );
  });

  it('swallows errors from notifyOrgUsers and notifyManagers (graceful degrade)', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    notifyOrgUsers.mockRejectedValue(new Error('notify error'));
    notifyManagers.mockRejectedValue(new Error('mgr notify error'));
    const sum = emptySummary();
    // Should NOT throw
    await expect(
      upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: true })
    ).resolves.not.toThrow();
    expect(sum.created).toBe(1);
  });

  it('does NOT notify when payment is a refund', async () => {
    const refundDto = {
      externalId: 'PR1',
      orderExternalId: 'O1',
      amount: 50,
      paidAt: '2026-04-01T00:00:00Z',
      isRefund: true,
      updatedAt: '2026-04-01T00:00:00Z',
    } as any;
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    await upsertPaymentRecord(d, refundDto, sum, { mode: 'live', notify: true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(notifyManagers).not.toHaveBeenCalled();
  });

  it('bump callback is called on existing payment update', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    d.payment.findUnique.mockResolvedValue({
      id: 'pay-ex',
      amount: 100,
      paidAt: new Date('2026-04-01T00:00:00Z'),
      purpose: null,
    });
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(payOrderDto.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump callback is called on new payment creation', async () => {
    const d = pdb();
    d.order.findUnique.mockResolvedValue({
      id: 'ord',
      organizationId: 'o',
      orderNumber: 'O1',
      title: 't',
    });
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertPaymentRecord(d, payOrderDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(payOrderDto.updatedAt);
    expect(sum.created).toBe(1);
  });
});

describe('upsertOrderRecord — additional branch coverage', () => {
  const baseDto = {
    externalId: 'O-EXTRA',
    orderNumber: 'O-EXTRA',
    title: 'T',
    organizationExternalId: 'E-ORG',
    totalAmount: 100,
    paidAmount: 0,
    vatIncluded: true,
    executionStatus: 'pending',
    financialStatus: 'billed',
    productMix: [],
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;

  beforeEach(() => {
    resolveOrganizationRef.mockReset();
    notifyOrgUsers.mockReset();
  });

  it('bump callback is called on create', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
      organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(baseDto.updatedAt);
  });

  it('bump callback is called on update', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex',
          organizationId: 'o',
          financialStatus: 'billed',
          orderNumber: 'O-EXTRA',
          title: 'T',
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(baseDto.updatedAt);
  });

  it('sets organizationId on update when existing.organizationId is null', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o-new',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex',
          organizationId: null,
          financialStatus: 'billed',
          orderNumber: 'O-EXTRA',
          title: 'T',
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false });
    const updateData = d.order.update.mock.calls[0][0].data;
    expect(updateData.organizationId).toBe('o-new');
  });

  it('uses org.id as targetOrgId when existing.organizationId is null (for notify)', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o-new',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const changedDto = { ...baseDto, financialStatus: 'paid' } as any;
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex',
          organizationId: null,
          financialStatus: 'billed',
          orderNumber: 'O-EXTRA',
          title: 'T',
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, changedDto, sum, { mode: 'live', notify: true });
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ organizationId: 'o-new' })
    );
  });

  it('swallows notifyOrgUsers error on status change (graceful degrade)', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    const changedDto = { ...baseDto, financialStatus: 'paid' } as any;
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex',
          organizationId: 'o',
          financialStatus: 'billed',
          orderNumber: 'O-EXTRA',
          title: 'T',
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    notifyOrgUsers.mockRejectedValue(new Error('notify boom'));
    const sum = emptySummary();
    await expect(
      upsertOrderRecord(d, changedDto, sum, { mode: 'live', notify: true })
    ).resolves.not.toThrow();
    expect(sum.updated).toBe(1);
  });

  it('does NOT notify when financial status is unchanged', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: 'c',
      partnerId: null,
      externalId: 'E-ORG',
    });
    // same financialStatus as dto ('billed')
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex',
          organizationId: 'o',
          financialStatus: 'billed',
          orderNumber: 'O-EXTRA',
          title: 'T',
        }),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('skips when org.companyId is null', async () => {
    resolveOrganizationRef.mockResolvedValue({
      id: 'o',
      companyId: null,
      partnerId: null,
      externalId: 'E-ORG',
    });
    const d = {
      order: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertOrderRecord(d, baseDto, sum, { mode: 'live', notify: false });
    expect(sum.skipped).toBe(1);
    expect(sum.skips[0]).toMatchObject({ reason: 'organization_not_found' });
  });
});

describe('upsertDocumentRecord — additional branch coverage', () => {
  const docDto = {
    externalId: 'D-EX',
    orderExternalId: 'O-1',
    direction: 'incoming',
    type: 'contract',
    name: 'Договор',
    mimeType: 'application/pdf',
    size: 10,
    downloadUrl: 'https://1c/d1',
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;

  beforeEach(() => {
    fetchAndStore1CDocument.mockReset();
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
    notifyOrgUsers.mockReset();
    getQueue.mockReset();
    getQueue.mockReturnValue({ add: vi.fn() });
  });

  it('does NOT notify when organizationId is null on new document', async () => {
    const d = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: null, orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'doc1' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });

  it('swallows document scan enqueue error (graceful degrade)', async () => {
    const prevRedis = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://test';
    try {
      getQueue.mockReturnValue({ add: vi.fn().mockRejectedValue(new Error('redis down')) });
      const d = {
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'ord1',
            organizationId: 'o1',
            orderNumber: 'O-1',
            title: 't',
          }),
        },
        document: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'doc9' }),
          update: vi.fn(),
        },
      } as any;
      const sum = emptySummary();
      await expect(
        upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false })
      ).resolves.not.toThrow();
      expect(sum.created).toBe(1);
    } finally {
      if (prevRedis === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prevRedis;
    }
  });

  it('swallows notifyOrgUsers error for document_published (graceful degrade)', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('notify boom'));
    const d = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: 'o1', orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'doc9' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await expect(
      upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: true })
    ).resolves.not.toThrow();
    expect(sum.created).toBe(1);
  });

  it('document update in shadow mode counts updated but does not write', async () => {
    const d = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: 'o1', orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex-doc',

          externalId: 'D-EX',

          type: 'contract',

          status: 'issued',

          number: null,

          version: 1,

          mimeType: 'application/pdf',

          size: 10,

          signedAt: null,

          uploadedById: null,

          sentById: null,
        }),

        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'shadow', notify: false });
    expect(d.document.update).not.toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });

  it('bump is called on document update', async () => {
    const d = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: 'o1', orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ex-doc',

          externalId: 'D-EX',

          type: 'contract',

          status: 'issued',

          number: null,

          version: 1,

          mimeType: 'application/pdf',

          size: 10,

          signedAt: null,

          uploadedById: null,

          sentById: null,
        }),

        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(docDto.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump is called on document create', async () => {
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/uuid-file.pdf');
    const d = {
      order: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'ord1', organizationId: 'o1', orderNumber: 'O-1', title: 't' }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-doc' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertDocumentRecord(d, docDto, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(docDto.updatedAt);
    expect(sum.created).toBe(1);
  });
});

describe('upsertDocumentRecord — У-170: обратная связь из 1С (три ключа, файл, подпись)', () => {
  /**
   * `Д-24`: подписанный в 1С договор возвращался вторым документом — writer
   * искал только по `externalId`. Теперь три ключа по порядку, обновление
   * найденного, повторный скан при смене файла и приём через дверь статусов.
   */
  const dto = (over: Record<string, unknown> = {}) =>
    ({
      externalId: '1c-777',
      orderExternalId: 'O-1',
      direction: 'incoming',
      type: 'contract',
      name: 'Договор.pdf',
      mimeType: 'application/pdf',
      size: 10,
      downloadUrl: 'https://1c/d777',
      updatedAt: '2026-09-01T00:00:00Z',
      ...over,
    }) as any;
  /** Наш документ (выгружен в 1С): `externalId` пуст, id 1С лежит в `oneCExternalId`. */
  const ours = (over: Record<string, unknown> = {}) => ({
    id: 'doc-ours',
    externalId: null,
    type: 'contract',
    status: 'sent',
    number: 'Д-2026-5',
    version: 1,
    mimeType: 'application/pdf',
    size: 10,
    signedAt: null,
    uploadedById: 'u-issuer',
    sentById: null,
    ...over,
  });
  function db({
    byExternalId = null,
    byOneCId = null,
    byNumber = null,
    numberTaken = false,
  }: {
    byExternalId?: Record<string, unknown> | null;
    byOneCId?: Record<string, unknown> | null;
    byNumber?: Record<string, unknown> | null;
    numberTaken?: boolean;
  } = {}) {
    const findFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      if ('oneCExternalId' in where) return byOneCId;
      if ('orderId' in where) return byNumber;
      // проверка «номер свободен в компании»
      return numberTaken ? { id: 'other-doc' } : null;
    });
    return {
      order: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'ord1',
          organizationId: 'o1',
          companyId: 'co1',
          orderNumber: 'O-1',
          title: 't',
        }),
      },
      document: {
        findUnique: vi.fn().mockResolvedValue(byExternalId),
        findFirst,
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
        update: vi.fn(),
      },
    } as any;
  }
  const live = { mode: 'live' as const, notify: true };
  const updateData = (d: any) => d.document.update.mock.calls[0][0].data;

  beforeEach(() => {
    fetchAndStore1CDocument.mockReset();
    fetchAndStore1CDocument.mockResolvedValue('orders/ord1/1c/new.pdf');
    setDocumentStatus.mockReset();
    setDocumentStatus.mockResolvedValue({ ok: true });
    notifyOrgUsers.mockReset();
    getQueue.mockReset();
    getQueue.mockReturnValue({ add: vi.fn() });
  });

  it('ключ 2: выгруженный нами документ вернулся под id 1С (oneCExternalId) — обновлён, не создан', async () => {
    const d = db({ byOneCId: ours() });
    const sum = emptySummary();
    await upsertDocumentRecord(d, dto(), sum, live);
    expect(d.document.create).not.toHaveBeenCalled();
    expect(sum).toMatchObject({ created: 0, updated: 1, skipped: 0 });
    expect(d.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-ours' },
      data: expect.objectContaining({ oneCExternalId: '1c-777' }),
    });
    // уведомление «опубликован документ» — только про новую бумагу
    expect(notifyOrgUsers).not.toHaveBeenCalled();
    // порядок ключей: сперва externalId, потом oneCExternalId действующей версии
    expect(d.document.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalId: '1c-777' } })
    );
    expect(d.document.findFirst.mock.calls[0][0]).toMatchObject({
      where: { oneCExternalId: '1c-777', supersededAt: null },
      orderBy: { version: 'desc' },
    });
  });

  it('ключ 3: тот же тип и номер в заказе — обновлён; без номера в DTO третий ключ не ищется', async () => {
    const d = db({ byNumber: ours() });
    await upsertDocumentRecord(d, dto({ number: 'Д-2026-5' }), emptySummary(), live);
    expect(d.document.create).not.toHaveBeenCalled();
    expect(d.document.findFirst.mock.calls[1][0]).toMatchObject({
      where: { orderId: 'ord1', type: 'contract', number: 'Д-2026-5', supersededAt: null },
      orderBy: { version: 'desc' },
    });

    const d2 = db({ byNumber: ours() });
    await upsertDocumentRecord(d2, dto(), emptySummary(), live);
    expect(d2.document.findFirst).toHaveBeenCalledTimes(1);
    expect(d2.document.create).toHaveBeenCalled();
  });

  it('имя и тип: своей бумаге (ключ 1) 1С хозяин — меняет; нашей (ключи 2/3) — нет', async () => {
    const d = db({ byOneCId: ours() });
    await upsertDocumentRecord(d, dto({ name: 'Иное.pdf', type: 'act' }), emptySummary(), live);
    expect(updateData(d)).not.toHaveProperty('name');
    expect(updateData(d)).not.toHaveProperty('type');

    const d2 = db({ byExternalId: ours({ externalId: '1c-777' }) });
    await upsertDocumentRecord(d2, dto({ name: 'Иное.pdf', type: 'act' }), emptySummary(), live);
    expect(updateData(d2)).toMatchObject({ name: 'Иное.pdf', type: 'act' });
  });

  it('файл не менялся — не забирается заново, path не пишется, скан не ставится', async () => {
    process.env.REDIS_URL = 'redis://test';
    try {
      const d = db({ byExternalId: ours({ externalId: '1c-777' }) });
      await upsertDocumentRecord(d, dto(), emptySummary(), live);
      expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
      expect(updateData(d)).not.toHaveProperty('path');
      expect(updateData(d)).not.toHaveProperty('scanStatus');
      expect(getQueue).not.toHaveBeenCalled();
    } finally {
      delete process.env.REDIS_URL;
    }
  });

  it('файл изменился (размер) — забирается заново, path и pending, повторный скан ClamAV', async () => {
    process.env.REDIS_URL = 'redis://test';
    try {
      const add = vi.fn();
      getQueue.mockReturnValue({ add });
      const d = db({ byOneCId: ours() });
      await upsertDocumentRecord(d, dto({ size: 99 }), emptySummary(), live);
      expect(fetchAndStore1CDocument).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://1c/d777', orderId: 'ord1' })
      );
      expect(updateData(d)).toMatchObject({
        path: 'orders/ord1/1c/new.pdf',
        name: 'Договор.pdf',
        mimeType: 'application/pdf',
        size: 99,
        scanStatus: 'pending',
        scanReason: null,
        scannedAt: null,
      });
      expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
      expect(add).toHaveBeenCalledWith('scan', { kind: 'document', id: 'doc-ours' });
    } finally {
      delete process.env.REDIS_URL;
    }
  });

  it('файл изменился, но забрать не удалось — пропуск document_fetch_failed, запись не тронута', async () => {
    fetchAndStore1CDocument.mockResolvedValue(null);
    const d = db({ byOneCId: ours() });
    const sum = emptySummary();
    await upsertDocumentRecord(d, dto({ mimeType: 'image/png' }), sum, live);
    expect(d.document.update).not.toHaveBeenCalled();
    expect(sum).toMatchObject({ updated: 0, skipped: 1 });
    expect(sum.skips[0]).toEqual({ externalId: '1c-777', reason: 'document_fetch_failed' });
  });

  it('появилась подпись — файл забирается заново, документ принимается через дверь статусов от имени выпустившего', async () => {
    const d = db({ byOneCId: ours({ status: 'sent', uploadedById: 'u-issuer' }) });
    await upsertDocumentRecord(d, dto({ signedAt: '2026-09-02T00:00:00Z' }), emptySummary(), live);
    expect(fetchAndStore1CDocument).toHaveBeenCalled();
    expect(updateData(d).signedAt).toEqual(new Date('2026-09-02T00:00:00Z'));
    // прямой `status:` в update запрещён — только дверь
    expect(updateData(d)).not.toHaveProperty('status');
    expect(setDocumentStatus).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ sub: 'u-issuer' }),
      { documentId: 'doc-ours', to: 'accepted' }
    );
  });

  it('нет uploadedById — актором становится sentById', async () => {
    const d = db({ byOneCId: ours({ uploadedById: null, sentById: 'u-sender' }) });
    await upsertDocumentRecord(d, dto({ signedAt: '2026-09-02T00:00:00Z' }), emptySummary(), live);
    expect(setDocumentStatus).toHaveBeenCalledWith(
      d,
      expect.objectContaining({ sub: 'u-sender' }),
      expect.anything()
    );
  });

  it('та же подпись у уже принятого документа — дверь не зовётся, файл не перекачивается', async () => {
    const signed = new Date('2026-09-02T00:00:00Z');
    const d = db({ byOneCId: ours({ status: 'accepted', signedAt: signed }) });
    await upsertDocumentRecord(d, dto({ signedAt: '2026-09-02T00:00:00Z' }), emptySummary(), live);
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    expect(setDocumentStatus).not.toHaveBeenCalled();
    expect(updateData(d).signedAt).toEqual(signed);
  });

  it('пустая подпись из 1С не стирает нашу', async () => {
    const signed = new Date('2026-08-01T00:00:00Z');
    const d = db({ byOneCId: ours({ signedAt: signed }) });
    await upsertDocumentRecord(d, dto(), emptySummary(), live);
    expect(updateData(d).signedAt).toEqual(signed);
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('некому приписать приём (нет ни uploadedById, ни sentById) — подпись записана, статус не трогается', async () => {
    const d = db({ byOneCId: ours({ uploadedById: null, sentById: null }) });
    await upsertDocumentRecord(d, dto({ signedAt: '2026-09-02T00:00:00Z' }), emptySummary(), live);
    expect(updateData(d).signedAt).toEqual(new Date('2026-09-02T00:00:00Z'));
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });

  it('отказ двери и её исключение не роняют пакет — документ всё равно обновлён', async () => {
    setDocumentStatus.mockResolvedValue({
      ok: false,
      error: 'invalid_transition',
      from: 'sent',
      to: 'accepted',
    });
    const sum1 = emptySummary();
    await expect(
      upsertDocumentRecord(
        db({ byOneCId: ours() }),
        dto({ signedAt: '2026-09-02T00:00:00Z' }),
        sum1,
        live
      )
    ).resolves.toBeUndefined();
    expect(sum1.updated).toBe(1);

    setDocumentStatus.mockRejectedValue(new Error('door boom'));
    const sum2 = emptySummary();
    await expect(
      upsertDocumentRecord(
        db({ byOneCId: ours() }),
        dto({ signedAt: '2026-09-02T00:00:00Z' }),
        sum2,
        live
      )
    ).resolves.toBeUndefined();
    expect(sum2.updated).toBe(1);
  });

  it('номер из 1С дописывается пустому, если свободен в компании; занятый — не пишется', async () => {
    const d = db({ byOneCId: ours({ number: null }) });
    await upsertDocumentRecord(d, dto({ number: '77' }), emptySummary(), live);
    expect(updateData(d)).toMatchObject({ number: '77' });
    expect(d.document.findFirst.mock.calls[1][0].where).toEqual({
      companyId: 'co1',
      type: 'contract',
      number: '77',
      version: 1,
    });

    const d2 = db({ byOneCId: ours({ number: null }), numberTaken: true });
    await upsertDocumentRecord(d2, dto({ number: '77' }), emptySummary(), live);
    expect(updateData(d2)).not.toHaveProperty('number');

    // свой номер у документа уже есть — чужим не перетирается
    const d3 = db({ byOneCId: ours({ number: 'Д-2026-5' }) });
    await upsertDocumentRecord(d3, dto({ number: '77' }), emptySummary(), live);
    expect(updateData(d3)).not.toHaveProperty('number');
  });

  it('создание: direction и number — из DTO, oneCExternalId = id 1С; занятый номер — без номера', async () => {
    const d = db();
    await upsertDocumentRecord(
      d,
      dto({ direction: 'outgoing', number: '77' }),
      emptySummary(),
      live
    );
    expect(d.document.create.mock.calls[0][0].data).toMatchObject({
      direction: 'outgoing',
      number: '77',
      externalId: '1c-777',
      oneCExternalId: '1c-777',
      signedAt: null,
    });

    const d2 = db({ numberTaken: true });
    await upsertDocumentRecord(d2, dto({ number: '77' }), emptySummary(), live);
    expect(d2.document.create.mock.calls[0][0].data).toMatchObject({ number: null });
  });

  it('в тени (shadow) найденный не пишется, файл не забирается, дверь не зовётся — но updated считается', async () => {
    const d = db({ byOneCId: ours() });
    const sum = emptySummary();
    await upsertDocumentRecord(d, dto({ size: 99, signedAt: '2026-09-02T00:00:00Z' }), sum, {
      mode: 'shadow',
      notify: true,
    });
    expect(fetchAndStore1CDocument).not.toHaveBeenCalled();
    expect(d.document.update).not.toHaveBeenCalled();
    expect(setDocumentStatus).not.toHaveBeenCalled();
    expect(sum.updated).toBe(1);
  });
});

describe('upsertOrgRecord — additional branch coverage', () => {
  const orgDto = {
    externalId: 'ORG-X',
    name: 'ООО Тест',
    inn: '77',
    kpp: '01',
    partnerExternalId: null,
    updatedAt: '2026-04-01T00:00:00Z',
  } as any;

  // Этап 4 (Т-19): пустой партнёр — это ПРЯМОЙ клиент, а не брак строки.
  it('создаёт организацию без партнёра как прямого клиента (partnerId: null)', async () => {
    const orgCreate = vi.fn().mockResolvedValue({ id: 'new-id' });
    const d = {
      partner: { findFirst: vi.fn() },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: orgCreate,
      },
    } as any;
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDto, sum, { mode: 'live', notify: false, createCompanyId: 'co1' });
    expect(sum.created).toBe(1);
    expect(sum.skips).toEqual([]);
    // Партнёрский поиск даже не выполнялся — искать нечего.
    expect(d.partner.findFirst).not.toHaveBeenCalled();
    expect(orgCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ partnerId: null, companyId: 'co1' }),
      select: { id: true },
    });
  });

  // Этап 4 (Т-20): партнёр ищется по ИНН ИЛИ прежнему slug одним запросом —
  // сетевой adapter-rest шлёт настоящие slug'и, файл — ИНН.
  it('ищет партнёра одним OR-запросом: нормализованный ИНН + сырой slug', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'p1' });
    const d = {
      partner: { findFirst },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
    } as any;
    const sum = emptySummary();
    const dto = { ...orgDto, partnerExternalId: ' 7712 345 678 ' } as any;
    await upsertOrgRecord(d, dto, sum, { mode: 'live', notify: false, createCompanyId: 'co1' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ inn: '7712345678' }, { slug: '7712 345 678' }] },
      select: { id: true },
    });
    expect(sum.created).toBe(1);
  });

  it('shadow mode: не пишет, но честно считает created', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId: 'p-slug' } as any;
    const d = {
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
    } as any;
    const sum = emptySummary();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, {
      mode: 'shadow',
      notify: false,
      createCompanyId: 'co1',
    });
    expect(d.organization.create).not.toHaveBeenCalled();
    expect(sum.created).toBe(1);
  });

  it('bump callback is called on existing org update', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId: 'p-slug' } as any;
    const d = {
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue({ id: 'o1', companyId: 'co1' }),
        update: vi.fn(),
      },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, { mode: 'live', notify: false, bump });
    expect(bump).toHaveBeenCalledWith(orgDtoWithPartner.updatedAt);
    expect(sum.updated).toBe(1);
  });

  it('bump is called on org create', async () => {
    const orgDtoWithPartner = { ...orgDto, partnerExternalId: 'p-slug' } as any;
    const d = {
      partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
      organization: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        create: vi.fn().mockResolvedValue({ id: 'new-id' }),
      },
    } as any;
    const sum = emptySummary();
    const bump = vi.fn();
    await upsertOrgRecord(d, orgDtoWithPartner, sum, {
      mode: 'live',
      notify: false,
      bump,
      createCompanyId: 'co1',
    });
    expect(bump).toHaveBeenCalledWith(orgDtoWithPartner.updatedAt);
  });
});

/**
 * Этап 8 (Т-33/Т-34): writer'ы возвращают WriteOutcome — сырьё истории импорта.
 * created → id созданной записи; updated → снимок «до» строго по списку Т-33;
 * shadow/skip → undefined (записи нет — откатывать нечего).
 */
describe('WriteOutcome (Т-34) — возврат результата writer-ов', () => {
  const orderDb = (existing: unknown = null) =>
    ({
      order: {
        findUnique: vi.fn().mockResolvedValue(existing),
        create: vi.fn().mockResolvedValue({ id: 'ord-new' }),
        update: vi.fn(),
      },
      organizationManager: { findMany: vi.fn().mockResolvedValue([]) },
    }) as any;
  const orderDto = {
    externalId: 'O-out',
    orderNumber: 'O-out',
    title: 'x',
    organizationExternalId: 'E-ORG',
    totalAmount: 200,
    paidAmount: 50,
    vatIncluded: true,
    executionStatus: 'pending',
    financialStatus: 'billed',
    productMix: [],
    updatedAt: '2026-08-06T00:00:00Z',
  } as any;

  it('заказ: created с id; updated со снимком финансового ядра; shadow → undefined', async () => {
    resolveOrganizationRef.mockResolvedValue({ id: 'o', companyId: 'c', partnerId: null });
    const created = await upsertOrderRecord(orderDb(), orderDto, emptySummary(), {
      mode: 'live',
      notify: false,
    });
    expect(created).toEqual({ entityId: 'ord-new', action: 'created' });

    const existing = {
      id: 'ord-ex',
      organizationId: 'o',
      financialStatus: 'not_billed',
      orderNumber: 'O-out',
      title: 'x',
      totalAmount: 100,
      paidAmount: 0,
      executionStatus: 'in_progress',
    };
    const updated = await upsertOrderRecord(orderDb(existing), orderDto, emptySummary(), {
      mode: 'live',
      notify: false,
    });
    expect(updated).toEqual({
      entityId: 'ord-ex',
      action: 'updated',
      before: {
        totalAmount: '100',
        paidAmount: '0',
        financialStatus: 'not_billed',
        executionStatus: 'in_progress',
      },
    });

    const shadow = await upsertOrderRecord(orderDb(existing), orderDto, emptySummary(), {
      mode: 'shadow',
      notify: false,
    });
    expect(shadow).toBeUndefined();
  });

  it('платёж: created с id; updated со снимком суммы/даты/назначения; shadow → undefined', async () => {
    const pdb = (existing: unknown = null) =>
      ({
        order: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'ord',
            organizationId: 'o',
            companyId: 'c',
            orderNumber: 'O',
            title: 't',
          }),
        },
        payment: {
          findUnique: vi.fn().mockResolvedValue(existing),
          create: vi.fn().mockResolvedValue({ id: 'pay-new' }),
          update: vi.fn(),
        },
      }) as any;
    const payDto = {
      externalId: 'P-out',
      orderExternalId: 'O-x',
      amount: 500,
      paidAt: '2026-08-01T00:00:00Z',
      isRefund: false,
      updatedAt: '2026-08-06T00:00:00Z',
    } as any;

    const created = await upsertPaymentRecord(pdb(), payDto, emptySummary(), {
      mode: 'live',
      notify: false,
    });
    expect(created).toEqual({ entityId: 'pay-new', action: 'created' });

    const existing = {
      id: 'pay-ex',
      amount: 300,
      paidAt: new Date('2026-07-01T00:00:00Z'),
      purpose: 'старое назначение',
    };
    const updated = await upsertPaymentRecord(pdb(existing), payDto, emptySummary(), {
      mode: 'live',
      notify: false,
    });
    expect(updated).toEqual({
      entityId: 'pay-ex',
      action: 'updated',
      before: {
        amount: '300',
        paidAt: '2026-07-01T00:00:00.000Z',
        purpose: 'старое назначение',
      },
    });

    const shadow = await upsertPaymentRecord(pdb(existing), payDto, emptySummary(), {
      mode: 'shadow',
      notify: false,
    });
    expect(shadow).toBeUndefined();
  });

  it('организация: created с id; updated со снимком реквизитов; shadow и skip → undefined', async () => {
    const odb2 = (existing: unknown = null) =>
      ({
        partner: { findFirst: vi.fn().mockResolvedValue({ id: 'p1' }) },
        organization: {
          findUnique: vi.fn().mockResolvedValue(existing),
          findFirst: vi.fn().mockResolvedValue(null),
          update: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: 'org-new' }),
        },
      }) as any;
    const dto = {
      externalId: 'ORG-out',
      name: 'Новое имя',
      inn: '7707083893',
      kpp: '01',
      updatedAt: '2026-08-06T00:00:00Z',
    } as any;

    const created = await upsertOrgRecord(odb2(), dto, emptySummary(), {
      mode: 'live',
      notify: false,
      createCompanyId: 'co1',
    });
    expect(created).toEqual({ entityId: 'org-new', action: 'created' });

    const existing = {
      id: 'org-ex',
      companyId: 'co1',
      externalId: null,
      name: 'Старое имя',
      inn: '7707083893',
      kpp: '99',
      partnerId: 'p-old',
    };
    const updated = await upsertOrgRecord(odb2(existing), dto, emptySummary(), {
      mode: 'live',
      notify: false,
    });
    expect(updated).toEqual({
      entityId: 'org-ex',
      action: 'updated',
      before: {
        name: 'Старое имя',
        inn: '7707083893',
        kpp: '99',
        externalId: null,
        partnerId: 'p-old',
      },
    });

    const shadow = await upsertOrgRecord(odb2(existing), dto, emptySummary(), {
      mode: 'shadow',
      notify: false,
    });
    expect(shadow).toBeUndefined();

    // Skip (партнёр не найден) → undefined.
    const d = odb2();
    d.partner.findFirst.mockResolvedValue(null);
    const skipped = await upsertOrgRecord(
      d,
      { ...dto, partnerExternalId: 'ghost' },
      emptySummary(),
      { mode: 'live', notify: false, createCompanyId: 'co1' }
    );
    expect(skipped).toBeUndefined();
  });
});
