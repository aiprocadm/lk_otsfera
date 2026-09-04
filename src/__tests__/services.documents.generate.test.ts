/**
 * Этап 8 (ФТ-9.4/9.5, PR-2) — generateOrderDocument: гейты/скоуп, полнота
 * реквизитов, номер счёта из счётчика, акт наследует номер, версии+replaces,
 * scanStatus=clean, graceful notify, storage-ошибка. Prisma/storage/pdf — фейки.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

const {
  recordAuditMock,
  uploadMock,
  downloadMock,
  removeMock,
  renderMock,
  renderContractMock,
  renderProposalMock,
  resolveOrgIssueScope,
  resolveLeadIssueScope,
  recordPiiAccessMock,
  notifyOrgUsers,
  getCompanyTeamVisibility,
  canSeeOrderMock,
  enqueueDocumentPush,
  logWarn,
} = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  uploadMock: vi.fn(),
  downloadMock: vi.fn(),
  removeMock: vi.fn(),
  renderMock: vi.fn(),
  renderContractMock: vi.fn(),
  renderProposalMock: vi.fn(),
  resolveOrgIssueScope: vi.fn(),
  resolveLeadIssueScope: vi.fn(),
  recordPiiAccessMock: vi.fn(),
  notifyOrgUsers: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn(),
  enqueueDocumentPush: vi.fn(),
  logWarn: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/pii/record', () => ({ recordPiiAccess: recordPiiAccessMock }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, download: downloadMock, remove: removeMock }),
}));
vi.mock('@/lib/services/documents/orderDocumentPdf', () => ({
  renderOrderDocumentPdf: renderMock,
}));
vi.mock('@/lib/services/documents/contractDocumentPdf', () => ({
  renderContractDocumentPdf: renderContractMock,
}));
vi.mock('@/lib/services/documents/proposalDocumentPdf', () => ({
  renderProposalDocumentPdf: renderProposalMock,
}));
// `У-145`: скоуп выпуска из карточки организации — свой сервис со своими
// тестами; здесь он мокается, иначе тесты выпуска проверяли бы его, а не себя.
vi.mock('@/lib/services/documents/issueScope', () => ({
  resolveOrgIssueScope,
  resolveLeadIssueScope,
}));
vi.mock('@/lib/notifications', () => ({ notifyOrgUsers }));
vi.mock('@/lib/auth/managerPolicy', () => ({
  getCompanyTeamVisibility,
  canSeeOrder: canSeeOrderMock,
}));
vi.mock('@/lib/logging', () => ({ log: { warn: logWarn, error: vi.fn(), info: vi.fn() } }));
// `У-169`: постановка в очередь выгрузки — свой сервис со своими тестами;
// здесь проверяется только, КОГДА выпуск его зовёт и что его сбой не мешает.
vi.mock('@/lib/services/oneCSync/pushDocument', () => ({ enqueueDocumentPush }));

import { generateOrderDocument } from '@/lib/services/documents/generate';

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

/** Финансовая строка заказа (`У-139`) в том виде, в каком её читает генератор. */
function line(title: string, unitPrice = '5000', over: Record<string, unknown> = {}) {
  return {
    title,
    quantity: 1,
    unit: 'service',
    unitPrice,
    discountPercent: null,
    vatRate: 0.2,
    vatIncluded: true,
    sortOrder: 0,
    ...over,
  };
}

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
  // `У-139` (этап 5): табличную часть печатают финансовые строки заказа.
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
    document: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: documentCreate,
      // `У-151`: прежняя версия гасится той же транзакцией.
      update: vi.fn().mockResolvedValue({}),
    },
    ...((over.tx as Record<string, unknown>) ?? {}),
  };
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(over.order === undefined ? ORDER : over.order) },
    // `У-153`: слоты оформления компании — по умолчанию пусто.
    // `У-151`: сервис проверяет занятость номера ДО рендера — своим
    // запросом, а не внутри транзакции резервирования.
    document: { findFirst: vi.fn().mockResolvedValue(null) },
    companyBrandingAsset: { findMany: vi.fn().mockResolvedValue(over.branding ?? []) },
    company: {
      findUnique: vi.fn().mockResolvedValue(over.company === undefined ? FULL_PARTY : over.company),
    },
    organization: {
      findUnique: vi
        .fn()
        .mockResolvedValue(over.organization === undefined ? FULL_PARTY : over.organization),
    },
    // `У-161` (этап 7): третья цель выпуска — лид. Сам лид читает гейт
    // `resolveLeadIssueScope` (он мокнут), а генератор доспрашивает только
    // сделку — ради связи документа с ней.
    deal: { findUnique: vi.fn().mockResolvedValue(over.deal ?? null) },
    $transaction: vi.fn().mockImplementation((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx, documentCreate };
}

beforeEach(() => {
  vi.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'));
  renderContractMock.mockResolvedValue(Buffer.from('%PDF-contract'));
  renderProposalMock.mockResolvedValue(Buffer.from('%PDF-proposal'));
  resolveOrgIssueScope.mockResolvedValue({ ok: true, companyId: 'co-A' });
  // `У-161`: гейт лида живёт в issueScope и мокается так же, как гейт
  // организации, — иначе тесты выпуска проверяли бы его, а не себя. По
  // умолчанию лида нет: тест, которому он нужен, скажет об этом явно.
  resolveLeadIssueScope.mockResolvedValue({ ok: false, error: 'not_found' });
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  downloadMock.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
  notifyOrgUsers.mockResolvedValue({});
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
  enqueueDocumentPush.mockResolvedValue({ ok: true });
});

describe('generateOrderDocument', () => {
  it('клиентская роль → forbidden; вне scope → not_found; нет организации → no_organization', async () => {
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, { sub: 'p', role: 'partner' } as never, {
        orderId: 'ord-1',
        docType: 'invoice',
      })
    ).toEqual({ ok: false, error: 'forbidden' });

    canSeeOrderMock.mockReturnValue(false);
    expect(
      await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })
    ).toEqual({ ok: false, error: 'not_found' });

    canSeeOrderMock.mockReturnValue(true);
    const noOrg = makePrisma({ order: { ...ORDER, organizationId: null } });
    expect(
      await generateOrderDocument(noOrg.prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })
    ).toEqual({ ok: false, error: 'no_organization' });
  });

  it('неполные реквизиты → missing_requisites со списком; генерации нет', async () => {
    const { prisma } = makePrisma({ company: { ...FULL_PARTY, bic: null, signerName: null } });
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('missing_requisites');
      // Сужение: у ветки amount_mismatch поля `missing` нет.
      if (r.error === 'missing_requisites') {
        expect(r.missing!.map((m) => m.label)).toEqual(
          expect.arrayContaining(['БИК исполнителя', 'подписант исполнителя (ФИО)'])
        );
      }
    }
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('счёт: счётчик даёт номер «С-{год}-{N}», документ system/outgoing/clean, аудит, notify', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma, tx, documentCreate } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-1', number: 'С-2026-7' });

    expect(tx.documentCounter.upsert).toHaveBeenCalledWith({
      where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'invoice' } },
      create: { companyId: 'co-A', year: 2026, kind: 'invoice', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    const data = documentCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      type: 'invoice',
      direction: 'outgoing',
      generatedBy: 'system',
      scanStatus: 'clean',
      number: 'С-2026-7',
      version: 1,
      replacesDocumentId: null,
    });
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringContaining('orders/ord-1/generated/'),
      expect.any(Buffer),
      { contentType: 'application/pdf' }
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'document_generated' })
    );
    expect(notifyOrgUsers).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ type: 'document_published' })
    );
  });

  it('одна строка на сумму заказа без финансовых строк; построчно при их наличии', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    let table = renderMock.mock.calls[0]![0].table;
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].name).toContain('Услуги по заказу №123');
    // `У-142`: итог заглушки — ровно сумма заказа, ни копейкой больше.
    expect(table.gross).toBe('15000.00');

    renderMock.mockClear();
    const priced = makePrisma({ order: { ...ORDER, lines: [line('Высота'), line('ОТ', '7000')] } });
    await generateOrderDocument(priced.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
      // Строки дешевле суммы заказа — это отдельный вопрос `У-143`,
      // здесь проверяется печать состава.
      onAmountMismatch: 'keep_order',
    });
    table = renderMock.mock.calls[0]![0].table;
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].name).toBe('Высота');
    expect(table.gross).toBe('12000.00');
  });

  it('строка НДС: ставка заказа печатается суммой, её отсутствие — «не облагается»', async () => {
    // Строка НДС уходит в печатную форму счёта — бухгалтерия клиента сверяет
    // по ней сумму налога. Неверная формулировка = вопросы к каждому счёту.
    //
    // До этапа 6 «цены без НДС» (`vatIncluded: false`) печаталось как «НДС не
    // облагается» — это разные вещи: первое про способ расчёта, второе про
    // освобождение от налога. Освобождение задаёт ТОЛЬКО пустая ставка.
    const now = new Date('2026-07-26T12:00:00Z');
    const withRate = makePrisma();
    await generateOrderDocument(withRate.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    expect(renderMock.mock.calls[0]![0].table.vatLine).toBe(
      'В том числе НДС 20% — 2\u00a0500,00 ₽'
    );

    renderMock.mockClear();
    const noRate = makePrisma({
      order: { ...ORDER, vatIncluded: false, vatRate: null },
      company: { ...FULL_PARTY, defaultVatRate: null },
    });
    await generateOrderDocument(noRate.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    expect(renderMock.mock.calls[0]![0].table.vatLine).toBe('НДС не облагается');
  });

  it('`У-153`: логотип, подпись и печать компании доезжают до шаблона', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma({
      branding: [
        { slot: 'logo', path: 'company/co-A/branding/logo.png' },
        { slot: 'stamp', path: 'company/co-A/branding/stamp.png' },
      ],
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    const branding = renderMock.mock.calls[0]![0].branding;
    expect(branding.logo).toBeInstanceOf(Buffer);
    expect(branding.stamp).toBeInstanceOf(Buffer);
    // Подпись не загружали — слот остаётся пустым, документ печатается как прежде.
    expect(branding.signature).toBeNull();
  });

  it('`У-142`: у заказа без ставки берётся ставка по умолчанию компании', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma({
      order: { ...ORDER, vatRate: null },
      company: { ...FULL_PARTY, defaultVatRate: 0.1 },
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    expect(renderMock.mock.calls[0]![0].table.vatLine).toContain('НДС 10%');
  });

  it('строки печатаются своими наименованиями в порядке sortOrder', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma({
      order: {
        ...ORDER,
        lines: [line('Разработка инструкции', '3000'), line('Услуга', '2000')],
      },
    });
    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
      onAmountMismatch: 'keep_order',
    });
    const rows = renderMock.mock.calls[0]![0].table.rows;
    expect(rows[0].name).toBe('Разработка инструкции');
    expect(rows[1].name).toBe('Услуга');
  });

  it('заказ без номера: строка услуг без «№», заголовок не ломается', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma({ order: { ...ORDER, orderNumber: null } });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    const row = renderMock.mock.calls[0]![0].table.rows[0];
    expect(row.name).toBe('Услуги по заказу: Обучение по ОТ');
  });

  it('displayName стороны: юр. название приоритетнее рабочего, пустые оба → пустая строка', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma } = makePrisma({
      organization: { ...FULL_PARTY, legalName: null, name: 'Рабочее имя' },
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    expect(renderMock.mock.calls[0]![0].organization.displayName).toBe('Рабочее имя');

    // Компания без рабочего имени в выборке (name отсутствует в PARTY_SELECT):
    // fallback-цепочка не должна падать на undefined.
    renderMock.mockClear();
    const p2 = makePrisma({
      company: { ...FULL_PARTY, legalName: 'ООО Исполнитель', name: undefined },
    });
    await generateOrderDocument(p2.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    expect(renderMock.mock.calls[0]![0].company.displayName).toBe('ООО Исполнитель');
  });

  it('заказ без companyId → missing_requisites с понятной причиной', async () => {
    const { prisma } = makePrisma({ order: { ...ORDER, companyId: null } });
    getCompanyTeamVisibility.mockResolvedValue(false);
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(r).toMatchObject({ ok: false, error: 'missing_requisites' });
    if (!r.ok && r.error === 'missing_requisites') {
      expect(r.missing![0].label).toContain('компания-исполнитель');
    }
  });

  it('карточка компании или организации исчезла между проверками → not_found', async () => {
    const noCompany = makePrisma({ company: null });
    expect(
      await generateOrderDocument(noCompany.prisma, manager(), {
        orderId: 'ord-1',
        docType: 'invoice',
      })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });

    const noOrg = makePrisma({ organization: null });
    expect(
      await generateOrderDocument(noOrg.prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })
    ).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('не-Storage ошибка из транзакции пробрасывается наружу', async () => {
    const { prisma } = makePrisma();
    (prisma.$transaction as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('deadlock'));
    await expect(
      generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' })
    ).rejects.toThrow('deadlock');
  });

  it('`У-151`: акт получает СВОЙ номер, а со счётом его связывает явное поле', async () => {
    // Раньше акт выдёргивал число из номера счёта и склеивал его со своим
    // префиксом. Из-за этого два доп. соглашения к одному договору получали
    // один номер (`Д-4`), а акт, выпущенный в январе, носил номер
    // прошлогоднего счёта с новым годом. Связь теперь держит
    // `parentDocumentId`, а номер приходит из счётчика.
    const now = new Date('2026-07-26T12:00:00Z');
    const withInvoice = makePrisma({
      tx: {
        documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 18 }) },
        document: {
          findFirst: vi.fn().mockResolvedValueOnce({
            id: 'inv-1',
            number: 'С-2026-17',
            createdAt: new Date('2026-07-01'),
          }),
          create: vi
            .fn()
            .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
              Promise.resolve({ id: 'doc-2', version: data.version })
            ),
        },
      },
    });
    const r = await generateOrderDocument(withInvoice.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'act',
      now,
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-2', number: 'А-2026-18' });
    const created = (withInvoice.tx.document.create as ReturnType<typeof vi.fn>).mock.calls[0]![0]
      .data;
    expect(created).toMatchObject({ parentDocumentId: 'inv-1', version: 1 });

    const noInvoice = makePrisma();
    expect(
      await generateOrderDocument(noInvoice.prisma, manager(), {
        orderId: 'ord-1',
        docType: 'act',
        now,
      })
    ).toEqual({ ok: false, error: 'invoice_required' });
  });

  it('`Д-4`: второй счёт по заказу — НОВЫЙ документ со своим номером, а не версия первого', async () => {
    // Раньше версия считалась «по типу»: второй счёт молча притворялся
    // версией первого, первый исчезал из работы, а его номер сгорал.
    const { prisma, documentCreate, tx } = makePrisma();
    (tx.document.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'doc-old',
      version: 3,
      number: 'С-2026-1',
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(documentCreate.mock.calls[0]![0].data).toMatchObject({
      version: 1,
      replacesDocumentId: null,
      number: 'С-2026-7',
    });
  });

  it('`Д-3`: перевыпуск сохраняет номер, растит версию и гасит прежнюю', async () => {
    const { prisma, documentCreate, tx } = makePrisma();
    (tx.document.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-1',
      version: 2,
      parentDocumentId: null,
    });
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      extras: { reissueOfDocumentId: 'doc-old' },
    });
    expect(r).toMatchObject({ ok: true, number: 'С-2026-1' });
    expect(documentCreate.mock.calls[0]![0].data).toMatchObject({
      number: 'С-2026-1',
      version: 3,
      replacesDocumentId: 'doc-old',
    });
    // Номер из счётчика не берётся: перевыпуск — та же бумага, а не новая.
    expect(tx.documentCounter.upsert as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    // Прежняя версия помечена заменённой ТОЙ ЖЕ транзакцией.
    expect(tx.document.update as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'doc-old' },
        data: { supersededAt: expect.anything() },
      })
    );
  });

  it('перевыпускать нечего — понятный отказ, а не молчаливый новый номер', async () => {
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    expect(
      await generateOrderDocument(prisma, manager(), {
        orderId: 'ord-1',
        docType: 'invoice',
        extras: { reissueOfDocumentId: 'нет-такого' },
      })
    ).toEqual({ ok: false, error: 'reissue_not_found' });
  });

  it('сбой notify не валит результат; StorageError → storage', async () => {
    notifyOrgUsers.mockRejectedValue(new Error('smtp down'));
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(r.ok).toBe(true);

    const boom = new Error('s3 down');
    boom.name = 'StorageError';
    uploadMock.mockRejectedValue(boom);
    const { prisma: p2 } = makePrisma();
    expect(
      await generateOrderDocument(p2, manager(), { orderId: 'ord-1', docType: 'invoice' })
    ).toEqual({ ok: false, error: 'storage' });
  });

  it('admin обходит canSeeOrder; not_found при отсутствии заказа', async () => {
    canSeeOrderMock.mockReturnValue(false);
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, { sub: 'a', role: 'admin' } as never, {
      orderId: 'ord-1',
      docType: 'invoice',
    });
    expect(r.ok).toBe(true);

    const none = makePrisma({ order: null });
    expect(
      await generateOrderDocument(none.prisma, manager(), { orderId: 'x', docType: 'invoice' })
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('договор и доп. соглашение (PR-3)', () => {
  it('договор: свой счётчик kind=contract, номер «Д-{год}-{N}»', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma, tx } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
      now,
    });
    expect(r).toEqual({ ok: true, documentId: 'doc-1', number: 'Д-2026-7' });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith({
      where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'contract' } },
      create: { companyId: 'co-A', year: 2026, kind: 'contract', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
  });

  it('доп. соглашение наследует номер договора; без договора → contract_required', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const withContract = makePrisma({
      tx: {
        documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 9 }) },
        document: {
          findFirst: vi.fn().mockResolvedValueOnce({
            id: 'contract-1',
            number: 'Д-2026-4',
            createdAt: new Date('2026-07-02'),
          }),
          create: vi
            .fn()
            .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
              Promise.resolve({ id: 'doc-3', version: data.version })
            ),
        },
      },
    });
    const r = await generateOrderDocument(withContract.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'extra_agreement',
      now,
    });
    // `У-151`: ДС получает СВОЙ номер из счётчика, а с договором его связывает
    // `parentDocumentId`. Раньше два ДС к одному договору носили один номер.
    expect(r).toEqual({ ok: true, documentId: 'doc-3', number: 'ДС-2026-9' });
    expect(withContract.tx.documentCounter.upsert as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    // Шаблон ДС получает ссылку на исходный договор.
    expect(renderContractMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: 'extra_agreement',
        baseContract: { number: 'Д-2026-4', date: new Date('2026-07-02') },
      })
    );

    const none = makePrisma();
    expect(
      await generateOrderDocument(none.prisma, manager(), {
        orderId: 'ord-1',
        docType: 'extra_agreement',
        now,
      })
    ).toEqual({
      ok: false,
      error: 'contract_required',
    });
  });
});

describe('`У-143`: сумма строк разошлась с суммой заказа', () => {
  const now = new Date('2026-07-26T12:00:00Z');
  const cheaper = () => makePrisma({ order: { ...ORDER, lines: [line('Обучение', '9000')] } });

  it('без ответа человека документ НЕ выпускается — возвращаются обе цифры', async () => {
    // Дефект `Д-8`: раньше система молча печатала одну из двух сумм.
    const { prisma } = cheaper();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    expect(r).toEqual({
      ok: false,
      error: 'amount_mismatch',
      linesTotal: '9000.00',
      orderTotal: '15000.00',
    });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('«обновить сумму заказа» — заказ выравнивается по строкам, с записью в журнал', async () => {
    const { prisma } = cheaper();
    const orderUpdate = vi.fn().mockResolvedValue({});
    (prisma as unknown as { order: { update: unknown } }).order.update = orderUpdate;

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
      onAmountMismatch: 'update_order',
    });
    expect(r.ok).toBe(true);
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'ord-1' },
      data: { totalAmount: '9000.00', totalAmountIsManual: false },
    });
    expect(recordAuditMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ action: 'order_total_synced' })
    );
  });

  it('«выпустить по строкам» — сумма заказа не трогается', async () => {
    const { prisma } = cheaper();
    const orderUpdate = vi.fn().mockResolvedValue({});
    (prisma as unknown as { order: { update: unknown } }).order.update = orderUpdate;

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
      onAmountMismatch: 'keep_order',
    });
    expect(r.ok).toBe(true);
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('у договора расхождение не спрашивается — деньги платят по счёту', async () => {
    const { prisma } = cheaper();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'contract',
      now,
    });
    expect(r.ok).toBe(true);
  });
});

describe('`У-152`: рендер и загрузка вне транзакции', () => {
  const now = new Date('2026-07-26T12:00:00Z');

  it('номер резервируется ОТДЕЛЬНОЙ транзакцией, а не одной длинной', async () => {
    // Дефект `Д-1`: одна транзакция держала строку счётчика номеров на время
    // рендера PDF и загрузки в хранилище.
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    expect(
      (prisma.$transaction as unknown as { mock: { calls: unknown[] } }).mock.calls
    ).toHaveLength(2);
  });

  it('ключ файла содержит UUID — повтор не перезаписывает прежний', async () => {
    // Дефект `Д-2`: ключ был детерминированным, и повторная попытка затирала
    // файл предыдущей версии.
    const first = makePrisma();
    await generateOrderDocument(first.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    const second = makePrisma();
    await generateOrderDocument(second.prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now,
    });
    const pathA = uploadMock.mock.calls[0]![0] as string;
    const pathB = uploadMock.mock.calls[1]![0] as string;
    expect(pathA).not.toBe(pathB);
    expect(pathA).toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('сбой записи документа убирает уже загруженный файл', async () => {
    // Иначе в хранилище копились бы файлы-сироты, за которые никто не отвечает.
    const { prisma, tx } = makePrisma();
    (tx.document.create as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('db down')
    );
    await expect(
      generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now })
    ).rejects.toThrow('db down');
    expect(removeMock).toHaveBeenCalledWith([uploadMock.mock.calls[0]![0]]);
  });

  it('сбой уборки не превращается в ошибку выпуска — исходная ошибка сохраняется', async () => {
    const { prisma, tx } = makePrisma();
    (tx.document.create as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(
      new Error('db down')
    );
    removeMock.mockRejectedValue(new Error('s3 down'));
    await expect(
      generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now })
    ).rejects.toThrow('db down');
  });
});

describe('`У-146`: строки документа — снимок состава', () => {
  it('документ сохраняет свои строки и итоги, а не ссылку на заказ', async () => {
    const now = new Date('2026-07-26T12:00:00Z');
    const { prisma, documentCreate } = makePrisma({
      order: { ...ORDER, totalAmount: 5000, lines: [line('Обучение')] },
    });
    await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice', now });
    const data = documentCreate.mock.calls[0]![0].data;
    expect(data.amountGross).toBe('5000.00');
    expect(data.currency).toBe('RUB');
    expect(data.lines.create).toEqual([
      expect.objectContaining({ title: 'Обучение', amount: '5000.00', sortOrder: 0 }),
    ]);
  });
});

describe('`У-147`: основание выбирается, а не угадывается', () => {
  const now = new Date('2026-07-26T12:00:00Z');

  it('выбранный счёт становится основанием акта и попадает в `parentDocumentId`', async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 'inv-7', number: 'С-2026-7', createdAt: now })
      .mockResolvedValue(null);
    const { prisma, documentCreate } = makePrisma({
      tx: {
        documentCounter: { upsert: vi.fn().mockResolvedValue({ lastNumber: 8 }) },
        document: {
          findFirst,
          create: vi.fn().mockResolvedValue({ id: 'doc-2' }),
          update: vi.fn().mockResolvedValue({}),
        },
      },
    });
    (prisma as unknown as { order: { findUnique: unknown } }).order.findUnique = vi
      .fn()
      .mockResolvedValue({ ...ORDER, totalAmount: 15000, lines: [] });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'act',
      now,
      extras: { parentDocumentId: 'inv-7' },
    });
    // `У-151`: номер у акта свой, из счётчика; со счётом его связывает поле.
    expect(r).toEqual({ ok: true, documentId: 'doc-2', number: 'А-2026-8' });
    // Выбор основания ищется ПО ИДЕНТИФИКАТОРУ, а не «последний по дате».
    expect(findFirst.mock.calls[0]![0].where).toMatchObject({ id: 'inv-7', orderId: 'ord-1' });
    void documentCreate;
  });

  it('выбранного основания нет в этом заказе → parent_not_found, а не чужой счёт', async () => {
    const { prisma } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'act',
      now,
      extras: { parentDocumentId: 'inv-from-other-order' },
    });
    expect(r).toEqual({ ok: false, error: 'parent_not_found' });
  });
});

/**
 * Этап 7 (`У-161`…`У-163`) — выпуск коммерческого предложения.
 *
 * Три вещи, которых нет ни у одного другого документа: он рождается
 * ЧЕРНОВИКОМ, у него может не быть адресата в системе, и компания-исполнитель
 * берётся из сессии, а не из данных. Каждая проверяется отдельно — вместе они
 * не проверяются никак.
 */
describe('generateOrderDocument — коммерческое предложение', () => {
  const LEAD = {
    id: 'lead-1',
    clientCompanyName: 'ООО «Ромашка»',
    clientContactName: 'Иван Петров',
    organizationId: null,
    assignedManagerId: 'm1',
  };
  /** Гейт лида пустил — дальше проверяем сам выпуск. */
  const leadAllowed = (over: Record<string, unknown> = {}) =>
    resolveLeadIssueScope.mockResolvedValue({
      ok: true,
      companyId: 'co-A',
      lead: { ...LEAD, ...over },
    });
  const LINES = [
    {
      title: 'Обучение по охране труда',
      quantity: '3',
      unit: 'person' as const,
      unitPrice: '5000.00',
      discountPercent: null,
      vatRate: '0.2000',
      vatIncluded: true,
    },
  ];

  it('КП организации: рождается ЧЕРНОВИКОМ, а не выставленным', async () => {
    const { prisma, documentCreate } = makePrisma();
    const r = await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
    });
    expect(r.ok).toBe(true);
    const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.status).toBe('draft');
    expect(data.type).toBe('commercial_proposal');
  });

  it('номер идёт из СВОЕЙ последовательности, а не из договорной', async () => {
    // Общий счётчик с договором разогнал бы номера договоров до сотен за
    // квартал: предложений выставляют кратно больше.
    const { prisma, tx, documentCreate } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
      now: new Date('2026-09-01T10:00:00Z'),
    });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'proposal' } },
      })
    );
    const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.number).toBe('КП-2026-7');
  });

  it('черновик клиенту НЕ анонсируется письмом', async () => {
    // Письмо «вам выпущен документ» о бумаге, которой клиент ещё не видит,
    // сбивает с толку: уведомление уезжает в момент отправки (`У-164`).
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
    });
    expect(notifyOrgUsers).not.toHaveBeenCalled();
  });

  it('печатается СВОИМ шаблоном, а не бланком счёта или договора', async () => {
    const { prisma } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
    });
    expect(renderProposalMock).toHaveBeenCalledTimes(1);
    expect(renderMock).not.toHaveBeenCalled();
    expect(renderContractMock).not.toHaveBeenCalled();
  });

  it('срок действия попадает В ПОЛЕ документа, а не только в текст', async () => {
    // Считать «истекло» по напечатанным словам невозможно (`У-162`).
    const until = new Date('2026-09-15T00:00:00Z');
    const { prisma, documentCreate } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
      extras: { validUntil: until },
    });
    const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.validUntil).toEqual(until);
  });

  it('срок не указали — берётся умолчание КОМПАНИИ, а не пустота', async () => {
    // Форма подставляет дату сама, но вход в сервис открыт и напрямую (тот же
    // разбор у предпросмотра). Без умолчания в сервисе в бумаге напечаталось
    // бы «действительно до —», то есть предложение без срока — прайс-лист.
    const { prisma, documentCreate } = makePrisma({
      company: { ...FULL_PARTY, proposalValidDays: 30 },
    });
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: LINES,
      now: new Date('2026-09-01T10:00:00Z'),
    });
    const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect((data.validUntil as Date).toISOString().slice(0, 10)).toBe('2026-10-01');
  });

  it('КП по ЗАКАЗУ не выпускается — предложение делают ДО заказа', async () => {
    // Иначе у предложения появился бы контрагент заказа, и оно уехало бы в
    // портфель партнёра вместе с ценами и скидками. Зеркально акту, у
    // которого запрет обратный.
    const { prisma } = makePrisma();
    expect(
      await generateOrderDocument(prisma, manager(), {
        orderId: 'ord-1',
        docType: 'commercial_proposal',
        lines: LINES,
      })
    ).toEqual({ ok: false, error: 'proposal_needs_no_order' });
  });

  /**
   * `У-166` (этап 7): предложение, выставленное ПО СДЕЛКЕ, должно найтись
   * потом в её карточке. Связь приходит из формы, поэтому сервер сверяет её
   * сам: чужая сделка означала бы чужую бумагу с ценами в чужих переговорах.
   */
  describe('связь со сделкой', () => {
    const DEAL = { id: 'deal-9', companyId: 'co-A', organizationId: 'org-1', leadId: null };

    it('своя сделка про того же клиента — связь записывается', async () => {
      const { prisma, documentCreate } = makePrisma({ deal: DEAL });
      const r = await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'commercial_proposal',
        lines: LINES,
        dealId: 'deal-9',
      });
      expect(r.ok).toBe(true);
      const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.dealId).toBe('deal-9');
    });

    it('сделка ЧУЖОЙ компании — отказ', async () => {
      const { prisma } = makePrisma({ deal: { ...DEAL, companyId: 'co-B' } });
      expect(
        await generateOrderDocument(prisma, manager(), {
          organizationId: 'org-1',
          docType: 'commercial_proposal',
          lines: LINES,
          dealId: 'deal-9',
        })
      ).toEqual({ ok: false, error: 'deal_mismatch' });
    });

    it('сделка про ДРУГОГО клиента — отказ', async () => {
      // Своя компания, но другая организация: бумага появилась бы в чужих
      // переговорах, и заметил бы это менеджер той сделки, а не мы.
      const { prisma } = makePrisma({ deal: { ...DEAL, organizationId: 'org-2' } });
      expect(
        await generateOrderDocument(prisma, manager(), {
          organizationId: 'org-1',
          docType: 'commercial_proposal',
          lines: LINES,
          dealId: 'deal-9',
        })
      ).toEqual({ ok: false, error: 'deal_mismatch' });
    });

    it('несуществующая сделка — отказ, а не тихое «без сделки»', async () => {
      const { prisma } = makePrisma();
      expect(
        await generateOrderDocument(prisma, manager(), {
          organizationId: 'org-1',
          docType: 'commercial_proposal',
          lines: LINES,
          dealId: 'нет-такой',
        })
      ).toEqual({ ok: false, error: 'deal_mismatch' });
    });

    it('без указания сделки связи нет — и это не ошибка', async () => {
      const { prisma, documentCreate } = makePrisma();
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.dealId).toBeUndefined();
    });
  });

  it('снимок строк ХРАНИТ признак «цена с НДС», а не значение по умолчанию', async () => {
    // Печать считает по строкам формы и была бы верной в любом случае, а вот
    // СНИМОК врал: колонка имеет значение по умолчанию «с НДС». Перенос
    // такого снимка в заказ (`У-164`) разошёлся бы с напечатанной суммой
    // ровно на ставку налога, и восстановить признак было бы неоткуда: при
    // ставке 0 и при «не облагается» суммы налога неразличимы.
    const { prisma, documentCreate } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      organizationId: 'org-1',
      docType: 'commercial_proposal',
      lines: [{ ...LINES[0]!, vatIncluded: false }],
    });
    const data = documentCreate.mock.calls[0]![0].data as {
      lines: { create: Array<Record<string, unknown>> };
    };
    expect(data.lines.create[0]!.vatIncluded).toBe(false);
  });

  it('счёту срок действия в поле не пишется — это поле предложения', async () => {
    const { prisma, documentCreate } = makePrisma();
    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      extras: { validUntil: new Date('2026-09-15T00:00:00Z') },
    });
    const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.validUntil).toBeUndefined();
  });

  describe('КП лиду — клиента ещё нет в системе (`У-161`)', () => {
    it('контрагента нет вовсе, зато записаны лид и его сделка', async () => {
      leadAllowed();
      const { prisma, documentCreate } = makePrisma({ deal: { id: 'deal-9' } });
      const r = await generateOrderDocument(prisma, manager(), {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(r.ok).toBe(true);
      const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
      // «Оба или ни одного»: половина контрагента не значит ничего и сломала
      // бы канальные выборки, которые сравнивают тип и id вместе.
      expect(data.counterpartyType).toBeNull();
      expect(data.counterpartyId).toBeNull();
      expect(data.leadId).toBe('lead-1');
      expect(data.dealId).toBe('deal-9');
    });

    it('компания берётся ИЗ СЕССИИ — у лида её нет в модели', async () => {
      resolveLeadIssueScope.mockResolvedValue({ ok: true, companyId: 'co-B', lead: LEAD });
      const { prisma, documentCreate } = makePrisma();
      await generateOrderDocument(
        prisma,
        { sub: 'm2', role: 'manager', companyId: 'co-B' } as never,
        { leadId: 'lead-1', docType: 'commercial_proposal', lines: LINES }
      );
      const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.companyId).toBe('co-B');
    });

    it('сотруднику без компании отказываем НЕХВАТКОЙ РЕКВИЗИТОВ, а не «нет прав»', async () => {
      // «Нет прав» отправил бы человека искать у себя недостающий доступ,
      // которого не существует.
      resolveLeadIssueScope.mockResolvedValue({ ok: false, error: 'no_company' });
      const { prisma } = makePrisma();
      const r = await generateOrderDocument(prisma, { sub: 'm3', role: 'manager' } as never, {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(r).toMatchObject({ ok: false, error: 'missing_requisites' });
    });

    it('файл кладётся под ЛИД, а не под несуществующую организацию', async () => {
      leadAllowed();
      const { prisma } = makePrisma();
      await generateOrderDocument(prisma, manager(), {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(uploadMock.mock.calls[0]![0]).toMatch(/^leads\/lead-1\/generated\//);
    });

    it('чтение ПДн лида записывается в журнал: имя контакта уходит в бумагу', async () => {
      // §12 CLAUDE.md: имя контактного лица печатается в КП. Карточку лида
      // человек мог и не открывать, а бумага с его именем ушла клиенту —
      // значит это отдельное чтение, а не `manager_lead_view`.
      leadAllowed();
      const { prisma } = makePrisma();
      await generateOrderDocument(prisma, manager(), {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(recordPiiAccessMock).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ context: 'proposal_issue_lead', subjectIds: ['lead-1'] })
      );
    });

    it('у КП организации журнала ПДн лида нет — физлица в бумаге не появилось', async () => {
      const { prisma } = makePrisma();
      await generateOrderDocument(prisma, manager(), {
        organizationId: 'org-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(recordPiiAccessMock).not.toHaveBeenCalled();
    });

    it('название клиента из карточки лида доезжает до печати', async () => {
      leadAllowed();
      const { prisma } = makePrisma();
      await generateOrderDocument(prisma, manager(), {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      const data = renderProposalMock.mock.calls[0]![0] as Record<string, unknown>;
      expect(data.addressee).toEqual({ name: 'ООО «Ромашка»', contactName: 'Иван Петров' });
    });

    it('лид с организацией выпускает КАК ОРГАНИЗАЦИИ — второй нити документов не заводим', async () => {
      // Иначе у одного клиента появились бы две нити бумаг: одна в карточке
      // организации, вторая невидимая, на лиде.
      leadAllowed({ organizationId: 'org-1' });
      const { prisma, documentCreate } = makePrisma();
      const r = await generateOrderDocument(prisma, manager(), {
        leadId: 'lead-1',
        docType: 'commercial_proposal',
        lines: LINES,
      });
      expect(r.ok).toBe(true);
      const data = documentCreate.mock.calls[0]![0].data as Record<string, unknown>;
      expect(data.counterpartyType).toBe('organization');
      expect(data.counterpartyId).toBe('org-1');
      expect(data.leadId).toBeUndefined();
    });

    it('несуществующий лид → not_found, а не падение', async () => {
      // Гейт лида по умолчанию отвечает «не найдено» — он же скрывает и чужой
      // лид: существование наружу не подтверждаем.
      const { prisma } = makePrisma();
      expect(
        await generateOrderDocument(prisma, manager(), {
          leadId: 'нет-такого',
          docType: 'commercial_proposal',
          lines: LINES,
        })
      ).toEqual({ ok: false, error: 'not_found' });
    });

    it('СЧЁТ лиду выставить нельзя — послабление только для предложения', async () => {
      // Иначе счёт ушёл бы клиенту без реквизитов и без организации: платить
      // по нему некому и не с чего.
      leadAllowed();
      const { prisma } = makePrisma();
      for (const docType of ['invoice', 'contract', 'extra_agreement'] as const) {
        expect(
          await generateOrderDocument(prisma, manager(), {
            leadId: 'lead-1',
            docType,
            lines: LINES,
          }),
          docType
        ).toEqual({ ok: false, error: 'lead_target_proposal_only' });
      }
    });

    it('две цели сразу — отказ, как на несуществующий объект', async () => {
      leadAllowed();
      const { prisma } = makePrisma();
      expect(
        await generateOrderDocument(prisma, manager(), {
          leadId: 'lead-1',
          organizationId: 'org-1',
          docType: 'commercial_proposal',
          lines: LINES,
        })
      ).toEqual({ ok: false, error: 'not_found' });
    });
  });
});

describe('`У-169`: правило `auto` — постановка в очередь выгрузки в 1С после выпуска', () => {
  const ALL = ['invoice', 'act', 'contract', 'extra_agreement'];
  const companyWith = (mode: string, types: string[] = ALL) => ({
    ...FULL_PARTY,
    oneCDocumentPushMode: mode,
    oneCDocumentPushTypes: types,
  });

  it('при `auto` задача ставится ПОСЛЕ записи документа, от имени выпустившего', async () => {
    const { prisma, documentCreate } = makePrisma({ company: companyWith('auto') });
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r).toMatchObject({ ok: true, documentId: 'doc-1' });
    expect(enqueueDocumentPush).toHaveBeenCalledWith(prisma, 'doc-1', { actorUserId: 'm1' });
    // Порядок: сначала документ в базе, потом очередь — иначе воркер искал бы
    // бумагу, которой ещё нет.
    expect(documentCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      enqueueDocumentPush.mock.invocationCallOrder[0]!
    );
  });

  it('при `auto` перевыпуск тоже уезжает — новой версией', async () => {
    const { prisma, tx } = makePrisma({ company: companyWith('auto') });
    (tx.document.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-1',
      version: 2,
      parentDocumentId: null,
    });
    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      extras: { reissueOfDocumentId: 'doc-old' },
    });
    expect(r).toMatchObject({ ok: true });
    expect(enqueueDocumentPush).toHaveBeenCalledWith(prisma, 'doc-1', { actorUserId: 'm1' });
  });

  it('при `manual` и `never` очередь не трогается', async () => {
    for (const mode of ['manual', 'never']) {
      const { prisma } = makePrisma({ company: companyWith(mode) });
      const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
      expect(r, mode).toMatchObject({ ok: true });
    }
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('тип вне набора компании не ставится, даже при `auto`', async () => {
    const { prisma } = makePrisma({ company: companyWith('auto', ['act', 'contract']) });
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r).toMatchObject({ ok: true });
    expect(enqueueDocumentPush).not.toHaveBeenCalled();
  });

  it('постановка отказала (нет Redis) — выпуск состоялся, отказ в логе', async () => {
    enqueueDocumentPush.mockResolvedValue({ ok: false, error: 'queue_unavailable' });
    const { prisma } = makePrisma({ company: companyWith('auto') });
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r).toMatchObject({ ok: true, documentId: 'doc-1' });
    expect(logWarn).toHaveBeenCalledWith(
      '[documents/generate] auto push to 1C not queued',
      expect.objectContaining({ documentId: 'doc-1', reason: 'queue_unavailable' })
    );
  });

  it('постановка БРОСИЛА — выпуск всё равно ok: true (спека 3.3), клиент уведомлён', async () => {
    enqueueDocumentPush.mockRejectedValue(new Error('redis down'));
    const { prisma } = makePrisma({ company: companyWith('auto') });
    const r = await generateOrderDocument(prisma, manager(), { orderId: 'ord-1', docType: 'invoice' });
    expect(r).toEqual({ ok: true, documentId: 'doc-1', number: 'С-2026-7' });
    expect(logWarn).toHaveBeenCalledWith(
      '[documents/generate] auto push to 1C failed',
      expect.objectContaining({ documentId: 'doc-1', error: 'redis down' })
    );
    expect(notifyOrgUsers).toHaveBeenCalled();
  });
});
