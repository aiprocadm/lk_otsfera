/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — generateOrderDocument: гейты/скоуп, полнота
 * реквизитов, номер счёта из счётчика, акт наследует номер, версии+replaces,
 * scanStatus=clean, graceful notify, storage-ошибка. Prisma/storage/pdf — фейки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const { recordAuditMock, uploadMock, renderMock, renderContractMock, notifyOrgUsers, getCompanyTeamVisibility, canSeeOrderMock } = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  uploadMock: vi.fn(),
  renderMock: vi.fn(),
  renderContractMock: vi.fn(),
  notifyOrgUsers: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn()
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ upload: uploadMock }) }));
vi.mock('@/lib/services/documents/orderDocumentPdf', () => ({ renderOrderDocumentPdf: renderMock }));
vi.mock('@/lib/services/documents/contractDocumentPdf', () => ({ renderContractDocumentPdf: renderContractMock }));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/auth/managerPolicy', () => ({ getCompanyTeamVisibility, canSeeOrder: canSeeOrderMock }));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { generateOrderDocument } from '@/lib/services/documents/generate';

const manager = (): SessionPayload => ({ sub: 'm1', role: 'manager', companyId: 'co-A' } as unknown as SessionPayload);

const FULL_PARTY = {
  name: 'Раб',
  legalName: 'ООО «Тест»',
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'Москва',
  bankName: 'Банк',
  bankAccount: '40702810400000000001',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов',
  signerPosition: 'Директор',
  phone: null,
  email: null
};

const ORDER = {
  id: 'ord-1',
  title: 'Обучение по ОТ',
  orderNumber: '123',
  companyId: 'co-A',
  organizationId: 'org-1',
  managerId: 'm1',
  totalAmount: 15000,
  vatIncluded: true,
  vatRate: 0.2,
  items: [] as unknown[]
};

function makePrisma(over: Record<string, unknown> = {}) {
  const documentCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'doc-1', version: data.version })
  );
  const tx = {
    documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 7 }) },
    document: { findFirst: vi.fn().mockResolvedValue(null), create: documentCreate },
    ...((over.tx as Record<string, unknown>) ?? {})
  };
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(over.order === undefined ? ORDER : over.order) },
    company: { findUnique: vi.fn().mockResolvedValue(over.company === undefined ? FULL_PARTY : over.company) },
    organization: { findUnique: vi.fn().mockResolvedValue(over.organization === undefined ? FULL_PARTY : over.organization) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx))
  } as unknown as PrismaClient;
  return { prisma, tx, documentCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'));
  renderContractMock.mockResolvedValue(Buffer.from('%PDF-contract'));
  uploadMock.mockResolvedValue(undefined);
  notifyOrgUsers.mockResolvedValue({});
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
});

describe('generateOrderDocument', () => {
  it('клиентская роль → forbidden; вне scope → not_found; нет организации → no_organization', async () => {
    const { prisma } = makePrisma();
    expect(await generateOrderDocument(prisma, { sub: 'p', role: 'partner' } as never, { orderId: 'ord-1', docType: 'invoice' })).toEqual({ ok: false, error: 'forbidden' });

    canSeeOrderMock.mockReturnValue(false);
    expect(await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })).toEqual({ ok: false, error: 'not_found' });

    canSeeOrderMock.mockReturnValue(true);
    const noOrg = makePrisma({ order: { ...ORDER, organizationId: null } });
    expect(await generateOrderDocument(noOrg.prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })).toEqual({ ok: false, error: 'no_organization' });
  });

  it('неполные реквизиты → missing_requisites со списком; генерации нет', async () => {
    const { prisma } = makePrisma({ company: { ...FULL_PARTY, bic: null, signerName: null } });
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('missing_requisites');
      expect(r.missing!.map((m) => m.label)).toEqual(expect.arrayContaining(['БИК исполнителя', 'подписант исполнителя (ФИО)']));
    }
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('счёт: счётчик даёт номер «С-{год}-{N}», документ system/outgoing/clean, аудит, notify', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma, tx, documentCreate } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    expect(r).toEqual({ ok: true, documentId: 'doc-1', number: 'С-2026-7' });

    expect(tx.documentCounter.upsert).toHaveBeenCalledWith({
      where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'invoice' } },
      create: { companyId: 'co-A', year: 2026, kind: 'invoice', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } }
    });
    const data = documentCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      type: 'invoice',
      direction: 'outgoing',
      generatedBy: 'system',
      scanStatus: 'clean',
      number: 'С-2026-7',
      version: 1,
      replacesDocumentId: null
    });
    expect(uploadMock).toHaveBeenCalledWith(expect.stringContaining('orders/ord-1/generated/'), expect.any(Buffer), { contentType: 'application/pdf' });
    expect(recordAuditMock).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'document_generated' }));
    expect(notifyOrgUsers).toHaveBeenCalledWith(prisma, expect.objectContaining({ type: 'document_published' }));
  });

  it('одна строка на сумму заказа без цен позиций; попозиционно при amount', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    let data = renderMock.mock.calls[0]![0];
    expect(data.items).toHaveLength(1);
    expect(data.items[0].name).toContain('Услуги по заказу №123');

    renderMock.mockClear();
    const priced = makePrisma({
      order: {
        ...ORDER,
        items: [
          { amount: 5000, note: null, direction: { name: 'Высота' }, student: { name: 'Петров' } },
          { amount: 7000, note: null, direction: { name: 'ОТ' }, student: null }
        ]
      }
    });
    await generateOrderDocument(priced.prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    data = renderMock.mock.calls[0]![0];
    expect(data.items).toHaveLength(2);
    expect(data.items[0].name).toBe('Высота — Петров');
    expect(data.total).toContain('12');
  });

  it('акт наследует номер последнего счёта; без счёта → invoice_required', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const withInvoice = makePrisma({
      tx: {
        documentCounter: { upsert: vi.fn() },
        document: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ number: 'С-2026-17', createdAt: new Date('2026-07-01') }) // последний счёт
            .mockResolvedValueOnce({ id: 'act-old', version: 2 }), // прежний акт
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'doc-2', version: data.version }))
        }
      }
    });
    const r = await generateOrderDocument(withInvoice.prisma, manager(), { orderId: 'ord-1', docType: 'act', now });
    expect(r).toEqual({ ok: true, documentId: 'doc-2', number: 'А-2026-17' });
    expect((withInvoice.tx.documentCounter.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();

    const noInvoice = makePrisma();
    expect(await generateOrderDocument(noInvoice.prisma, manager(), { orderId: 'ord-1', docType: 'act', now })).toEqual({ ok: false, error: 'invoice_required' });
  });

  it('повторная генерация → version+1 и replacesDocumentId', async () => {
    const { prisma, documentCreate, tx } = makePrisma();
    (tx.document.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'doc-old', version: 3 });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(documentCreate.mock.calls[0]![0].data).toMatchObject({ version: 4, replacesDocumentId: 'doc-old' });
  });

  it('сбой notify не валит результат; StorageError → storage', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('smtp down'));
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r.ok).toBe(true);

    const boom = new Error('s3 down');
    boom.name = 'StorageError';
    uploadMock.mockRejectedValue(boom);
    const { prisma: p2 } = makePrisma();
    expect(await generateOrderDocument(p2, manager(), { orderId: 'ord-1', docType: 'invoice' })).toEqual({ ok: false, error: 'storage' });
  });

  it('admin обходит canSeeOrder; not_found при отсутствии заказа', async () => {
    canSeeOrderMock.mockReturnValue(false);
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, { sub: 'a', role: 'admin' } as never, { orderId: 'ord-1', docType: 'invoice' });
    expect(r.ok).toBe(true);

    const none = makePrisma({ order: null });
    expect(await generateOrderDocument(none.prisma, manager(), { orderId: 'x', docType: 'invoice' })).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('договор и доп. соглашение (PR-3)', () => {
  it('договор: свой счётчик kind=contract, номер «Д-{год}-{N}»', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma, tx } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'contract', now });
    expect(r).toEqual({ ok: true, documentId: 'doc-1', number: 'Д-2026-7' });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith({
      where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'contract' } },
      create: { companyId: 'co-A', year: 2026, kind: 'contract', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } }
    });
  });

  it('доп. соглашение наследует номер договора; без договора → contract_required', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const withContract = makePrisma({
      tx: {
        documentCounter: { upsert: vi.fn() },
        document: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ number: 'Д-2026-4', createdAt: new Date('2026-07-02') })
            .mockResolvedValueOnce(null),
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'doc-3', version: data.version }))
        }
      }
    });
    const r = await generateOrderDocument(withContract.prisma, manager(), { orderId: 'ord-1', docType: 'extra_agreement', now });
    expect(r).toEqual({ ok: true, documentId: 'doc-3', number: 'ДС-2026-4' });
    expect((withContract.tx.documentCounter.upsert as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // Шаблон ДС получает ссылку на исходный договор.
    expect(renderContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ docType: 'extra_agreement', baseContract: { number: 'Д-2026-4', date: new Date('2026-07-02') } })
    );

    const none = makePrisma();
    expect(await generateOrderDocument(none.prisma, manager(), { orderId: 'ord-1', docType: 'extra_agreement', now })).toEqual({
      ok: false,
      error: 'contract_required'
    });
  });
});
