/**
 * Этап 6, PR-7 (`У-160`) — шаблон в генераторе: предпросмотр и выпуск берут
 * один и тот же текст, редакция записывается по НАПЕЧАТАННЫМ абзацам, а сбой
 * чтения шаблона не отменяет выпуск договора. Prisma/storage/pdf — фейки.
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
  logWarn,
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
  logWarn: vi.fn(),
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
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, error: vi.fn(), info: vi.fn() },
}));

import { generateOrderDocument, previewOrderDocument } from '@/lib/services/documents/generate';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

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
  lines: [] as unknown[],
};

function makePrisma(over: Record<string, unknown> = {}) {
  const documentCreate = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'doc-1', version: data.version })
    );
  const tx = {
    documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 7 }) },
    document: { findFirst: vi.fn().mockResolvedValue(null), create: documentCreate },
  };
  const templateFindMany =
    (over.templateFindMany as ReturnType<typeof vi.fn>) ??
    vi.fn().mockResolvedValue(over.templates ?? []);
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(ORDER) },
    // `У-151`: сервис проверяет занятость номера ДО рендера — своим
    // запросом, а не внутри транзакции резервирования.
    document: { findFirst: vi.fn().mockResolvedValue(null) },
    companyBrandingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    company: { findUnique: vi.fn().mockResolvedValue(FULL_PARTY) },
    organization: { findUnique: vi.fn().mockResolvedValue(FULL_PARTY) },
    documentTemplate: { findMany: templateFindMany },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx, documentCreate, templateFindMany };
}

const clauseText = (key: string) =>
  (renderContractMock.mock.calls[0]![0].clauses as Array<{ key: string; text: string }>).find(
    (c) => c.key === key
  )?.text;

beforeEach(() => {
  vi.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'));
  renderContractMock.mockResolvedValue(Buffer.from('%PDF-contract'));
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  notifyOrgUsers.mockResolvedValue({});
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
  canSeeOrganizationMock.mockReturnValue(true);
});

describe('шаблон в генераторе (`У-160`)', () => {
  it('без своих текстов договор печатается встроенными и получает редакцию 0', async () => {
    const { prisma, documentCreate } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
    });
    expect(r.ok).toBe(true);
    expect(clauseText('liability')).toContain('в соответствии с законодательством');
    // 0 — «печатали встроенным текстом». null означало бы «документ выпущен
    // до этой доработки», и два разных случая стали бы неразличимы.
    expect(documentCreate.mock.calls[0]![0].data.templateVersion).toBe(0);
  });

  it('свой текст компании доезжает до PDF, а его редакция — до документа', async () => {
    const { prisma, documentCreate, templateFindMany } = makePrisma({
      templates: [
        { slot: 'payment', body: 'Оплата 100% предоплатой.', revision: 5 },
        { slot: 'liability', body: 'Отвечаем по закону.', revision: 2 },
      ],
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'contract' });
    expect(templateFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'co-A' } })
    );
    expect(clauseText('payment')).toBe('Оплата 100% предоплатой.');
    expect(documentCreate.mock.calls[0]![0].data.templateVersion).toBe(5);
  });

  it('счёту и акту редакция не пишется — редактируемых абзацев у них нет', async () => {
    const { prisma, documentCreate, templateFindMany } = makePrisma();
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(documentCreate.mock.calls[0]![0].data.templateVersion).toBeNull();
    // И лишнего запроса за шаблоном на каждый счёт тоже нет.
    expect(templateFindMany).not.toHaveBeenCalled();
  });

  it('сбой чтения шаблона не отменяет выпуск: договор печатается встроенным текстом', async () => {
    const { prisma, documentCreate } = makePrisma({
      templateFindMany: vi.fn().mockRejectedValue(new Error('база недоступна')),
    });
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
    });
    expect(r.ok).toBe(true);
    expect(documentCreate.mock.calls[0]![0].data.templateVersion).toBe(0);
    expect(logWarn).toHaveBeenCalled();
  });

  it('предпросмотр печатает те же абзацы, что и выпуск, и номер не тратит', async () => {
    const templates = [{ slot: 'payment', body: 'Оплата в день выставления счёта.', revision: 3 }];
    const preview = makePrisma({ templates });
    await previewOrderDocument(preview.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
    });
    const fromPreview = renderContractMock.mock.calls[0]![0].clauses;
    expect(preview.tx.documentCounter.upsert).not.toHaveBeenCalled();

    renderContractMock.mockClear();
    const issue = makePrisma({ templates });
    await generateOrderDocument(issue.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
    });
    // Посимвольное совпадение: человек видит ровно то, что уйдёт клиенту.
    expect(renderContractMock.mock.calls[0]![0].clauses).toEqual(fromPreview);
  });

  it('в журнал идёт редакция и «откуда взят абзац», но не тексты', async () => {
    const { prisma } = makePrisma({
      templates: [{ slot: 'payment', body: 'Секретная формулировка клиента.', revision: 8 }],
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'contract' });
    const audit = recordAuditMock.mock.calls.find((c) => c[1]?.action === 'document_generated')![1];
    expect(audit.after).toMatchObject({
      templateVersion: 8,
      templateSources: expect.objectContaining({ payment: 'template', liability: 'builtin' }),
    });
    expect(JSON.stringify(audit)).not.toContain('Секретная');
  });

  it('текст из формы выпуска важнее шаблона и в редакцию не попадает', async () => {
    const { prisma, documentCreate } = makePrisma({
      templates: [{ slot: 'payment', body: 'Текст компании.', revision: 6 }],
    });
    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
      extras: { paymentTerms: 'Разовая правка на этот договор.' },
    });
    expect(clauseText('payment')).toBe('Разовая правка на этот договор.');
    expect(documentCreate.mock.calls[0]![0].data.templateVersion).toBe(0);
  });

  it('срок действия из формы попадает в текст пункта подстановкой', async () => {
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
      extras: { validUntil: new Date('2026-12-31T00:00:00Z') },
    });
    expect(clauseText('term.contract')).toContain('действует до 31.12.2026');
  });
});
