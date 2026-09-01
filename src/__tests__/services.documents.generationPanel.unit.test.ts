/**
 * Unit-тесты src/lib/services/documents/generationPanel.ts — читающая половина
 * панели генерации счёта/акта (аудит A1: три запроса уехали с карточки заказа
 * менеджера в сервис). Пиннится форма запросов + обе ветки списка недостающих
 * реквизитов.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  getDocumentGenerationPanel,
  getLeadDocumentIssuePanel,
  getOrgDocumentIssuePanel,
} from '@/lib/services/documents/generationPanel';

const FULL = {
  name: 'Раб',
  legalName: 'ООО',
  inn: '7707083893',
  kpp: '770701001',
  ogrn: '1027700132195',
  legalAddress: 'адрес',
  bankName: 'Банк',
  bankAccount: '40702810400000000005',
  corrAccount: '30101810400000000225',
  bic: '044525225',
  signerName: 'Иванов',
  signerPosition: 'Директор',
  signerBasis: 'Устава',
};

function fakePrisma(opts: {
  company: unknown;
  organization: unknown;
  generated: { type: string }[];
  baseDocuments?: unknown[];
  lines?: unknown[];
}) {
  return {
    prisma: {
      company: { findUnique: vi.fn().mockResolvedValue(opts.company) },
      organization: { findUnique: vi.fn().mockResolvedValue(opts.organization) },
      document: {
        groupBy: vi.fn().mockResolvedValue(opts.generated),
        findMany: vi.fn().mockResolvedValue(opts.baseDocuments ?? []),
      },
      orderLine: { findMany: vi.fn().mockResolvedValue(opts.lines ?? []) },
    },
  };
}

const ARGS = { orderId: 'order-1', companyId: 'co-1', organizationId: 'org-1' };

describe('getDocumentGenerationPanel', () => {
  it('обе стороны заполнены: недостающего нет, флаги «уже сгенерировано» по типам', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: FULL,
      generated: [{ type: 'invoice' }],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.missingByType.invoice).toEqual([]);
    expect(panel.missingByType.contract).toEqual([]);
    expect(panel.hasInvoice).toBe(true);
    expect(panel.hasContract).toBe(false);
    expect(panel.counterpartyName).toBe('ООО');
    expect(prisma.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'co-1' },
      select: expect.objectContaining({ legalName: true, signerPosition: true }),
    });
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      select: expect.objectContaining({ inn: true, legalAddress: true }),
    });
    expect(prisma.document.groupBy).toHaveBeenCalledWith({
      by: ['type'],
      where: {
        orderId: 'order-1',
        type: { in: ['invoice', 'contract'] },
        generatedBy: 'system',
        // `Д-5`: счёт из 1С приходит без номера — основанием он не считается,
        // иначе кнопка «Акт» включалась бы, а выпуск падал непонятным отказом.
        number: { not: null },
      },
      _count: { _all: true },
    });
  });

  it('оба типа уже сгенерированы → обе кнопки помечены как повторные', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: FULL,
      generated: [{ type: 'invoice' }, { type: 'contract' }],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.hasInvoice).toBe(true);
    expect(panel.hasContract).toBe(true);
  });

  it('пустые реквизиты заказчика попадают в список недостающего', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: { ...FULL, inn: null, legalAddress: '   ', signerBasis: null },
      generated: [],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    // `У-156`: список считается ПО ТИПУ — счёт и договор требуют разного.
    expect(panel.missingByType.invoice.map((m) => m.label)).toEqual([
      'ИНН заказчика',
      'юр. адрес заказчика',
    ]);
    expect(panel.missingByType.invoice.every((m) => m.side === 'organization')).toBe(true);
    expect(panel.missingByType.contract.map((m) => m.label)).toContain(
      'основание полномочий заказчика'
    );
  });

  it('сторона исчезла между запросами → список недостающего пуст, панель всё равно собирается', async () => {
    const { prisma } = fakePrisma({ company: null, organization: FULL, generated: [] });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.missingByType.invoice).toEqual([]);
    expect(panel.hasInvoice).toBe(false);
    expect(panel.hasContract).toBe(false);
    expect(panel.baseDocuments).toEqual([]);
    expect(panel.orderLines).toEqual([]);
  });

  it('`У-147`: счета и договоры заказа отдаются для выбора основания', async () => {
    const { prisma } = fakePrisma({
      company: FULL,
      organization: FULL,
      generated: [],
      baseDocuments: [
        { id: 'inv-1', type: 'invoice', number: 'С-2026-7', createdAt: new Date('2026-07-26') },
      ],
      lines: [
        {
          title: 'Обучение',
          quantity: { toString: () => '2' },
          unit: 'person',
          unitPrice: { toString: () => '5000' },
          discountPercent: null,
          vatRate: { toString: () => '0.2' },
          vatIncluded: true,
        },
      ],
    });

    const panel = await getDocumentGenerationPanel(prisma as never, ARGS);

    expect(panel.baseDocuments).toEqual([
      { id: 'inv-1', type: 'invoice', number: 'С-2026-7', date: '2026-07-26T00:00:00.000Z' },
    ]);
    // Состав заказа предзаполняет форму; Decimal через границу не проходит.
    expect(panel.orderLines[0]).toEqual({
      title: 'Обучение',
      quantity: '2',
      unit: 'person',
      unitPrice: '5000',
      discountPercent: null,
      vatRate: '0.2',
      vatIncluded: true,
    });
  });
});

/**
 * `У-145` — панель выпуска БЕЗ заказа. Проверяем ровно то, чем она отличается
 * от панели заказа: круг «соседей» (документы организации без заказа) и
 * каталог компании, из которого набирается состав.
 */
describe('getOrgDocumentIssuePanel', () => {
  function orgPrisma(over: Record<string, unknown> = {}) {
    const documentFindMany = vi.fn().mockResolvedValue(over.baseDocuments ?? []);
    const catalogFindMany = vi.fn().mockResolvedValue(over.catalog ?? []);
    const prisma = {
      // `?? ` здесь нельзя по той же причине, что и у организации ниже: тест
      // «компания не прочиталась» передаёт именно null.
      company: {
        findUnique: vi.fn().mockResolvedValue('company' in over ? over.company : FULL),
      },
      organization: {
        // `?? ` здесь нельзя: тест «сторона исчезла» передаёт именно null.
        findUnique: vi
          .fn()
          .mockResolvedValue(
            'organization' in over ? over.organization : { ...FULL, name: 'Клиент' }
          ),
      },
      document: { findMany: documentFindMany },
      catalogItem: { findMany: catalogFindMany },
    } as never;
    return { prisma, documentFindMany, catalogFindMany };
  }

  it('основания ДС ищутся среди документов организации БЕЗ заказа', async () => {
    const { prisma, documentFindMany } = orgPrisma({
      baseDocuments: [
        { id: 'd1', type: 'contract', number: 'Д-2026-1', createdAt: new Date('2026-08-01') },
      ],
    });
    const panel = await getOrgDocumentIssuePanel(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(documentFindMany.mock.calls[0]![0].where).toMatchObject({
      orderId: null,
      companyId: 'co-A',
      counterpartyType: 'organization',
      counterpartyId: 'org-1',
      type: 'contract',
    });
    expect(panel.hasContract).toBe(true);
    expect(panel.baseDocuments[0]!.number).toBe('Д-2026-1');
  });

  it('без договоров организации ДС выпускать не из чего', async () => {
    const { prisma } = orgPrisma();
    const panel = await getOrgDocumentIssuePanel(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(panel.hasContract).toBe(false);
    expect(panel.baseDocuments).toEqual([]);
  });

  it('каталог — только активные позиции компании, суммы строками', async () => {
    const { prisma, catalogFindMany } = orgPrisma({
      catalog: [
        {
          id: 'c1',
          name: 'Обучение',
          code: 'A-1',
          unit: 'person',
          price: { toFixed: (n: number) => (5000).toFixed(n) },
          vatRate: { toFixed: (n: number) => (0.2).toFixed(n) },
          vatIncluded: true,
        },
        {
          id: 'c2',
          name: 'Без НДС',
          code: 'A-2',
          unit: 'service',
          price: { toFixed: (n: number) => (100).toFixed(n) },
          vatRate: null,
          vatIncluded: false,
        },
      ],
    });
    const panel = await getOrgDocumentIssuePanel(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(catalogFindMany.mock.calls[0]![0].where).toEqual({
      companyId: 'co-A',
      isActive: true,
    });
    expect(panel.catalog).toEqual([
      {
        id: 'c1',
        name: 'Обучение',
        code: 'A-1',
        unit: 'person',
        price: '5000.00',
        vatRate: '0.2000',
        vatIncluded: true,
      },
      {
        id: 'c2',
        name: 'Без НДС',
        code: 'A-2',
        unit: 'service',
        price: '100.00',
        vatRate: null,
        vatIncluded: false,
      },
    ]);
  });

  it('ставка НДС компании отдаётся строкой; её отсутствие — это null, а не ноль', async () => {
    const withRate = orgPrisma({
      company: { ...FULL, defaultVatRate: { toFixed: (n: number) => (0.2).toFixed(n) } },
    });
    const panel = await getOrgDocumentIssuePanel(withRate.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(panel.defaultVatRate).toBe('0.2000');

    // УСН: ставки нет. Ноль сюда подставлять нельзя — «0 %» и «не облагается»
    // печатаются по-разному.
    const noRate = orgPrisma({ company: { ...FULL, defaultVatRate: null } });
    const plain = await getOrgDocumentIssuePanel(noRate.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(plain.defaultVatRate).toBeNull();
  });

  it('нехватка реквизитов считается по типам; исчезнувшая сторона не роняет панель', async () => {
    const withGaps = orgPrisma({ company: { ...FULL, bic: null } });
    const panel = await getOrgDocumentIssuePanel(withGaps.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(panel.missingByType.invoice.map((m) => m.label)).toContain('БИК исполнителя');
    // Договору банковские реквизиты не нужны — списки по типам разные.
    expect(panel.missingByType.contract.map((m) => m.label)).not.toContain('БИК исполнителя');

    const gone = orgPrisma({ organization: null });
    const empty = await getOrgDocumentIssuePanel(gone.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(empty.missingByType.invoice).toEqual([]);
    expect(empty.counterpartyName).toBe('заказчик');
  });

  it('`У-161`: у КП свой набор проверки — без банка исполнителя и только с названием заказчика', async () => {
    // У компании не заполнен банк, а у заказчика есть только рабочее
    // название — так выглядит клиент, которому ещё только предлагают.
    const { prisma } = orgPrisma({
      company: { ...FULL, bankName: null, bankAccount: null, corrAccount: null, bic: null },
      organization: {
        name: 'Клиент',
        legalName: null,
        inn: null,
        kpp: null,
        ogrn: null,
        legalAddress: null,
        bankName: null,
        bankAccount: null,
        corrAccount: null,
        bic: null,
        signerName: null,
        signerPosition: null,
        signerBasis: null,
      },
    });

    const panel = await getOrgDocumentIssuePanel(prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });

    // Ключ обязан быть в объекте. Раньше его там не было вовсе, а форма
    // читала его через `?? []` — то есть любая нехватка выглядела как
    // «всё в порядке», и отказ прилетал уже после нажатия «Выпустить».
    expect(panel.missingByType.commercial_proposal).toEqual([]);
    // Те же самые данные для счёта дают совсем другой список: по КП не
    // платят, поэтому банк ему не нужен, а адресата в системе может ещё не быть.
    expect(panel.missingByType.invoice.map((m) => m.label)).toEqual([
      'банк исполнителя',
      'р/с исполнителя',
      'к/с исполнителя',
      'БИК исполнителя',
      'ИНН заказчика',
      'юр. адрес заказчика',
    ]);
  });

  it('`У-162`: срок действия КП — число дней компании, без компании — 14', async () => {
    const custom = orgPrisma({ company: { ...FULL, proposalValidDays: 30 } });
    const panel = await getOrgDocumentIssuePanel(custom.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(panel.proposalValidDays).toBe(30);

    // Компания не прочиталась — форма всё равно должна предложить срок, и
    // ровно тот, что стоит по умолчанию в базе: разойдись они, экран показывал
    // бы один срок, а напоминание об истечении считало другой.
    const gone = orgPrisma({ company: null });
    const fallback = await getOrgDocumentIssuePanel(gone.prisma, {
      organizationId: 'org-1',
      companyId: 'co-A',
    });
    expect(fallback.proposalValidDays).toBe(14);
  });
});

/**
 * `У-161` — панель выпуска для ЛИДА. Клиента в системе ещё нет: ни
 * договоров, ни реквизитов, ни организации. Тип возврата тот же, что у
 * организации, поэтому проверяем ровно то, чем эта панель от неё отличается.
 */
describe('getLeadDocumentIssuePanel', () => {
  function leadPrisma(over: { company?: unknown; catalog?: unknown[] } = {}) {
    const companyFindUnique = vi.fn().mockResolvedValue('company' in over ? over.company : FULL);
    const catalogFindMany = vi.fn().mockResolvedValue(over.catalog ?? []);
    const documentFindMany = vi.fn().mockResolvedValue([]);
    const organizationFindUnique = vi.fn().mockResolvedValue(null);
    const prisma = {
      company: { findUnique: companyFindUnique },
      organization: { findUnique: organizationFindUnique },
      document: { findMany: documentFindMany },
      catalogItem: { findMany: catalogFindMany },
    } as never;
    return {
      prisma,
      companyFindUnique,
      catalogFindMany,
      documentFindMany,
      organizationFindUnique,
    };
  }

  const LEAD_ARGS = { companyId: 'co-A', leadName: 'ООО «Ромашка»' };

  it('у лида нет договоров: оснований не предлагаем и за ними не ходим', async () => {
    const { prisma, documentFindMany, organizationFindUnique } = leadPrisma();

    const panel = await getLeadDocumentIssuePanel(prisma, LEAD_ARGS);

    expect(panel.baseDocuments).toEqual([]);
    expect(panel.hasContract).toBe(false);
    // Договора у лида не бывает по определению, и организации тоже. Лишние
    // запросы значили бы, что панель ищет основания там, где их не бывает.
    expect(documentFindMany).not.toHaveBeenCalled();
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('заказчик в форме — название клиента из карточки лида', async () => {
    const named = leadPrisma();
    const panel = await getLeadDocumentIssuePanel(named.prisma, {
      companyId: 'co-A',
      leadName: '  ООО «Ромашка»  ',
    });
    expect(panel.counterpartyName).toBe('ООО «Ромашка»');

    // Название у лида заполняет человек, и оно может оказаться пустым.
    // Пустое место в шапке формы выглядело бы как сломанный экран.
    const blank = leadPrisma();
    const anonymous = await getLeadDocumentIssuePanel(blank.prisma, {
      companyId: 'co-A',
      leadName: '   ',
    });
    expect(anonymous.counterpartyName).toBe('клиент');
  });

  it('каталог и ставка НДС берутся из компании СЕССИИ: у лида своей нет', async () => {
    const { prisma, companyFindUnique, catalogFindMany } = leadPrisma({
      company: {
        ...FULL,
        defaultVatRate: { toFixed: (n: number) => (0.2).toFixed(n) },
        proposalValidDays: 30,
      },
      catalog: [
        {
          id: 'c1',
          name: 'Обучение',
          code: 'A-1',
          unit: 'person',
          price: { toFixed: (n: number) => (5000).toFixed(n) },
          vatRate: { toFixed: (n: number) => (0.2).toFixed(n) },
          vatIncluded: true,
        },
        {
          id: 'c2',
          name: 'Без НДС',
          code: 'A-2',
          unit: 'service',
          price: { toFixed: (n: number) => (100).toFixed(n) },
          vatRate: null,
          vatIncluded: false,
        },
      ],
    });

    const panel = await getLeadDocumentIssuePanel(prisma, LEAD_ARGS);

    expect(companyFindUnique).toHaveBeenCalledWith({
      where: { id: 'co-A' },
      select: expect.objectContaining({ defaultVatRate: true, proposalValidDays: true }),
    });
    expect(catalogFindMany.mock.calls[0]![0].where).toEqual({ companyId: 'co-A', isActive: true });
    expect(panel.defaultVatRate).toBe('0.2000');
    expect(panel.proposalValidDays).toBe(30);
    expect(panel.catalog).toEqual([
      {
        id: 'c1',
        name: 'Обучение',
        code: 'A-1',
        unit: 'person',
        price: '5000.00',
        vatRate: '0.2000',
        vatIncluded: true,
      },
      {
        id: 'c2',
        name: 'Без НДС',
        code: 'A-2',
        unit: 'service',
        price: '100.00',
        vatRate: null,
        vatIncluded: false,
      },
    ]);
  });

  it('нехватка по КП считается на клиента, у которого есть только название', async () => {
    const named = leadPrisma();
    const ready = await getLeadDocumentIssuePanel(named.prisma, LEAD_ARGS);
    // Название есть — больше от адресата КП ничего не нужно, и кнопка
    // «Выпустить» обязана быть доступна.
    expect(ready.missingByType.commercial_proposal).toEqual([]);
    // При этом заказчик именно пустой, а не «вторая копия исполнителя»:
    // для счёта у него по-прежнему нет ни ИНН, ни адреса.
    expect(ready.missingByType.invoice.map((m) => m.label)).toEqual([
      'ИНН заказчика',
      'юр. адрес заказчика',
    ]);

    // Названия нет — печатать в шапке предложения нечего, и форма
    // обязана сказать это до нажатия, а не после отказа сервиса.
    const nameless = leadPrisma();
    const gap = await getLeadDocumentIssuePanel(nameless.prisma, {
      companyId: 'co-A',
      leadName: '',
    });
    expect(gap.missingByType.commercial_proposal).toEqual([
      { side: 'organization', label: 'название заказчика' },
    ]);

    // Пробелы самого исполнителя видны и в КП: «проверять меньше» — не то
    // же самое, что «не проверять»: без подписанта шапка предложения пуста.
    const noSigner = leadPrisma({ company: { ...FULL, signerName: null } });
    const companyGap = await getLeadDocumentIssuePanel(noSigner.prisma, LEAD_ARGS);
    expect(companyGap.missingByType.commercial_proposal).toEqual([
      { side: 'company', label: 'подписант исполнителя (ФИО)' },
    ]);
  });

  it('компания не прочиталась — срок 14 дней, ставки нет, недостающее не выдумывается', async () => {
    const { prisma } = leadPrisma({ company: null });

    const panel = await getLeadDocumentIssuePanel(prisma, LEAD_ARGS);

    expect(panel.proposalValidDays).toBe(14);
    // УСН и «компания не прочиталась» дают одинаковый пустой ответ, а не ноль.
    expect(panel.defaultVatRate).toBeNull();
    // Одной стороны нет — список недостающего пуст (гейт выпуска всё
    // равно откажет), панель просто рисуется.
    expect(panel.missingByType.commercial_proposal).toEqual([]);
    expect(panel.catalog).toEqual([]);
  });
});
