/**
 * Этап 6, PR-6 (`У-145`) — выпуск документа **без заказа**: скоуп организации,
 * запрет акта, обязательный состав, «соседи» по организации, якорь
 * `companyId` вместо `orderId` и путь в хранилище. Prisma/storage/pdf — фейки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  recordAuditMock,
  uploadMock,
  removeMock,
  renderMock,
  renderContractMock,
  notifyOrgUsers,
  getCompanyTeamVisibility,
  canSeeOrderMock,
  canSeeOrganizationMock,
} = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  renderMock: vi.fn(),
  renderContractMock: vi.fn(),
  notifyOrgUsers: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn(),
  canSeeOrganizationMock: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, download: vi.fn(), remove: removeMock }),
}));
vi.mock('@/lib/services/documents/orderDocumentPdf', () => ({
  renderOrderDocumentPdf: renderMock,
}));
vi.mock('@/lib/services/documents/contractDocumentPdf', () => ({
  renderContractDocumentPdf: renderContractMock,
}));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  canSeeOrder: canSeeOrderMock,
  canSeeOrganization: canSeeOrganizationMock,
}));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { generateOrderDocument, previewOrderDocument } from '@/lib/services/documents/generate';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;
const admin = (): SessionPayload => ({ sub: 'a1', role: 'admin' }) as unknown as SessionPayload;

const FULL_PARTY = {
  name: 'Раб',
  legalName: 'ООО «Тест»',
  inn: '7707083893',
  kpp: '770701001',
  legalAddress: 'Москва',
  bankName: 'Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  ogrn: '1027700132195',
  signerName: 'Иванов',
  signerPosition: 'Директор',
  signerBasis: 'Устава',
  phone: null,
  email: null,
};

/** Строка состава, как её присылает форма выпуска. */
const LINE = {
  title: 'Консультация',
  quantity: '2',
  unit: 'service' as const,
  unitPrice: '5000',
  discountPercent: null,
  vatRate: '0.2000',
  vatIncluded: true,
};

/**
 * Организация возвращается двумя разными выборками: скоуп спрашивает только
 * `companyId`, реквизиты — весь блок. Фейк отдаёт объединение, поэтому оба
 * вызова получают то, что им нужно.
 */
function makePrisma(over: Record<string, unknown> = {}) {
  const documentCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'doc-9', version: data.version })
    );
  const documentFindFirst = vi.fn().mockResolvedValue(null);
  const tx = {
    documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 4 }) },
    document: { findFirst: documentFindFirst, create: documentCreate },
  };
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(null) },
    companyBrandingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    company: {
      findUnique: vi.fn().mockResolvedValue(over.company === undefined ? FULL_PARTY : over.company),
    },
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          over.organization === undefined ? { ...FULL_PARTY, companyId: 'co-A' } : over.organization
        ),
    },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx, documentCreate, documentFindFirst };
}

beforeEach(() => {
  vi.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'));
  renderContractMock.mockResolvedValue(Buffer.from('%PDF-contract'));
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  notifyOrgUsers.mockResolvedValue({});
  getCompanyTeamVisibility.mockResolvedValue(true);
  canSeeOrderMock.mockReturnValue(true);
  canSeeOrganizationMock.mockReturnValue(true);
});

describe('выпуск документа без заказа (`У-145`)', () => {
  it('счёт без заказа: якорь — компания, контрагент — организация, файл под организацией', async () => {
    const { prisma, documentCreate } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'invoice',
      lines: [LINE],
      now: new Date('2026-08-30T10:00:00Z'),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-9', number: 'С-2026-4' });

    const data = documentCreate.mock.calls[0]![0].data;
    // XOR-инвариант схемы: заказа нет, компания есть.
    expect(data.orderId).toBeUndefined();
    expect(data).toMatchObject({
      companyId: 'co-A',
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      status: 'issued',
      amountGross: '10000.00',
    });
    expect(String(uploadMock.mock.calls[0]![0])).toMatch(
      /^organizations\/org-1\/generated\/invoice-v1-/
    );
    // Письмо клиенту знает, что заказа нет, — и ведёт в раздел общих документов.
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        organizationId: 'org-1',
        payload: expect.objectContaining({ orderId: null, orderNumber: null, orderTitle: null }),
      })
    );
    // Аудит называет обе стороны: по нему потом ищут, кому что выставили.
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'document_generated',
        after: expect.objectContaining({ orderId: null, organizationId: 'org-1' }),
      })
    );
  });

  it('акт без заказа запрещён сервером, а не только выбором в форме', async () => {
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'act',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'act_requires_order' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('пустой состав без заказа → lines_required, ничего не выпускается', async () => {
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'invoice',
      })
    ).toEqual({ ok: false, error: 'lines_required' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('цель ровно одна: и заказ, и организация — как и ни одной — not_found', async () => {
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, manager(), {
        orderId: 'ord-1',
        organizationId: 'org-1',
        docType: 'invoice',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(
      await generateOrderDocument(prisma, manager(), { docType: 'invoice', lines: [LINE] })
    ).toEqual({ ok: false, error: 'not_found' });
    expect(prisma.order.findUnique).not.toHaveBeenCalled();
  });

  it('чужая компания и организация вне скоупа → not_found; админ проходит', async () => {
    const other = makePrisma({ organization: { ...FULL_PARTY, companyId: 'co-B' } });
    expect(
      await generateOrderDocument(other.prisma, manager(), {
        organizationId: 'org-1',
        docType: 'invoice',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'not_found' });

    // Без teamMode право даёт закрепление за менеджером.
    getCompanyTeamVisibility.mockResolvedValue(false);
    canSeeOrganizationMock.mockReturnValue(false);
    const mine = makePrisma();
    expect(
      await generateOrderDocument(mine.prisma, manager(), {
        organizationId: 'org-1',
        docType: 'invoice',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'not_found' });

    const asAdmin = makePrisma();
    const r = await generateOrderDocument(asAdmin.prisma, admin(), {
      organizationId: 'org-1',
      docType: 'invoice',
      lines: [LINE],
    });
    expect(r.ok).toBe(true);
  });

  it('организация без компании-исполнителя → missing_requisites, а не «нет доступа»', async () => {
    const { prisma } = makePrisma({ organization: { ...FULL_PARTY, companyId: null } });
    const r = await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'invoice',
      lines: [LINE],
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === 'missing_requisites') {
      expect(r.missing!.map((m) => m.label)).toContain('компания-исполнитель организации');
    } else {
      expect.unreachable('ожидался missing_requisites');
    }
  });

  it('несуществующая организация → not_found', async () => {
    const { prisma } = makePrisma({ organization: null });
    expect(
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-нет',
        docType: 'invoice',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'not_found' });
  });

  it('ДС без заказа ищет договор той же организации без заказа, а не по заказу', async () => {
    const { prisma, tx, documentFindFirst } = makePrisma();
    documentFindFirst.mockResolvedValueOnce({
      id: 'doc-contract',
      number: 'Д-2026-3',
      createdAt: new Date('2026-08-01T00:00:00Z'),
    });
    const r = await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'extra_agreement',
      lines: [LINE],
      now: new Date('2026-08-30T10:00:00Z'),
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-9', number: 'ДС-2026-3' });
    expect(documentFindFirst.mock.calls[0]![0].where).toMatchObject({
      orderId: null,
      companyId: 'co-A',
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      type: 'contract',
    });
    // Номер ведомого документа наследуется, счётчик не тратится.
    expect(tx.documentCounter.upsert).not.toHaveBeenCalled();
  });

  it('ДС без договора у организации → contract_required', async () => {
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'extra_agreement',
        lines: [LINE],
      })
    ).toEqual({ ok: false, error: 'contract_required' });
  });

  it('договор без заказа печатается с типовым предметом и без строки про заказ', async () => {
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'contract',
      lines: [LINE],
    });
    expect(r.ok).toBe(true);
    expect(renderContractMock.mock.calls[0]![0]).toMatchObject({ subject: 'Оказание услуг' });
  });

  it('предпросмотр счёта без заказа не печатает подзаголовок заказа и не тратит номер', async () => {
    const { prisma, tx } = makePrisma();
    const r = await previewOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'invoice',
      lines: [LINE],
    });
    expect(r.ok).toBe(true);
    expect(renderMock.mock.calls[0]![0]).toMatchObject({ orderLabel: null, number: '—' });
    expect(tx.documentCounter.upsert).not.toHaveBeenCalled();
  });
});
