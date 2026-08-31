/**
 * Этап 6, PR-8a (`У-151`) — нумерация и версии в `generateOrderDocument`.
 *
 * Здесь проверяется только то, ЧТО ЗА НОМЕР и КАКАЯ ВЕРСИЯ достаются документу:
 * новый документ против перевыпуска (`Д-4`, `Д-3`), собственный номер ведомого
 * типа, честный отказ по основанию без номера (`Д-5`), отказ на занятом номере
 * ДО дорогих шагов и год номера по Москве (`Д-22`). Печать, реквизиты и гейты
 * живут в соседнем файле `services.documents.generate.test.ts` — дублировать их
 * тут нечего.
 *
 * Prisma, хранилище и рендер PDF — фейки: нумерация не должна зависеть ни от
 * живой базы, ни от настоящих байтов.
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
  notifyOrgUsers,
  getCompanyTeamVisibility,
  canSeeOrderMock,
} = vi.hoisted(() => ({
  recordAuditMock: vi.fn(),
  uploadMock: vi.fn(),
  downloadMock: vi.fn(),
  removeMock: vi.fn(),
  renderMock: vi.fn(),
  renderContractMock: vi.fn(),
  notifyOrgUsers: vi.fn(),
  getCompanyTeamVisibility: vi.fn(),
  canSeeOrderMock: vi.fn(),
}));
vi.mock('@/lib/auth/audit', () => ({ recordAudit: recordAuditMock }));
vi.mock('@/lib/storage', () => ({
  getObjectStorage: () => ({ upload: uploadMock, download: downloadMock, remove: removeMock }),
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
}));
vi.mock('@/lib/logging', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { generateOrderDocument } from '@/lib/services/documents/generate';

const manager = (): SessionPayload =>
  ({ sub: 'm1', role: 'manager', companyId: 'co-A' }) as unknown as SessionPayload;

/** Полные реквизиты: нехватка реквизитов отсекает выпуск до нумерации. */
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
  // Состава нет — печатается строка-заглушка ровно на сумму заказа, поэтому
  // вопрос о расхождении сумм (`У-143`) в нумерационных тестах не всплывает.
  lines: [] as unknown[],
};

type Fn = ReturnType<typeof vi.fn>;

type Options = {
  /** Что вернёт счётчик номеров после инкремента. */
  lastNumber?: number;
  /** Кого найдёт проверка занятости номера (`null` — номер свободен). */
  clash?: { id: string } | null;
};

/**
 * Фейк Prisma со «следом» вызовов: `trace` пишет, что и внутри какой
 * транзакции произошло. Без него «прежняя версия гасится ТОЙ ЖЕ транзакцией»
 * пришлось бы принимать на веру — а именно это и есть смысл `Д-3`.
 */
function makePrisma(options: Options = {}) {
  const trace: string[] = [];
  const tx = {
    documentCounter: {
      upsert: vi.fn().mockImplementation(async () => {
        trace.push('counter');
        return { lastNumber: options.lastNumber ?? 7 };
      }),
    },
    document: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: { data: { version: number } }) => {
        trace.push('create');
        return { id: 'doc-new', version: data.version };
      }),
      update: vi.fn().mockImplementation(async () => {
        trace.push('supersede');
        return {};
      }),
    },
  };
  /** Проверка занятости номера — запрос КЛИЕНТА, вне транзакции резервирования. */
  const clashFindFirst: Fn = vi.fn().mockResolvedValue(options.clash ?? null);
  /** Такого вызова быть не должно: гашение прежней версии живёт в транзакции. */
  const looseUpdate: Fn = vi.fn().mockResolvedValue({});
  const prisma = {
    order: { findUnique: vi.fn().mockResolvedValue(ORDER), update: vi.fn().mockResolvedValue({}) },
    document: { findFirst: clashFindFirst, update: looseUpdate },
    companyBrandingAsset: { findMany: vi.fn().mockResolvedValue([]) },
    documentTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    company: { findUnique: vi.fn().mockResolvedValue({ ...FULL_PARTY, defaultVatRate: 0.2 }) },
    organization: { findUnique: vi.fn().mockResolvedValue(FULL_PARTY) },
    $transaction: vi.fn().mockImplementation(async (fn: (t: unknown) => unknown) => {
      trace.push('tx:begin');
      const result = await fn(tx);
      trace.push('tx:commit');
      return result;
    }),
  } as unknown as PrismaClient;
  return { prisma, tx, trace, clashFindFirst, looseUpdate };
}

/** Данные, с которыми создавали документ. */
function createdData(tx: ReturnType<typeof makePrisma>['tx']): Record<string, unknown> {
  return (tx.document.create as Fn).mock.calls[0]![0].data as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  renderMock.mockResolvedValue(Buffer.from('%PDF-fake'));
  renderContractMock.mockResolvedValue(Buffer.from('%PDF-contract'));
  uploadMock.mockResolvedValue(undefined);
  removeMock.mockResolvedValue(undefined);
  downloadMock.mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]));
  notifyOrgUsers.mockResolvedValue({});
  getCompanyTeamVisibility.mockResolvedValue(false);
  canSeeOrderMock.mockReturnValue(true);
});

const NOW = new Date('2026-07-26T12:00:00Z');

describe('`У-151`: новый документ против перевыпуска', () => {
  it('`Д-4`: второй счёт по заказу — новый номер и version 1, никого не заменяет', async () => {
    // Раньше версия считалась «по типу документа»: второй счёт молча
    // становился версией первого, первый уходил из работы, а его номер сгорал.
    // Клиент получал два разных счёта под одним номером — платить было не по
    // чему. Признак нового документа ровно один: в форме не выбран перевыпуск.
    const { prisma, tx, trace } = makePrisma({ lastNumber: 42 });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
    });

    expect(r).toEqual({ ok: true, documentId: 'doc-new', number: 'С-2026-42' });
    expect(createdData(tx)).toMatchObject({
      number: 'С-2026-42',
      version: 1,
      replacesDocumentId: null,
    });
    // Номер взят из счётчика, а счётчик сдвинут на единицу: следующий счёт
    // получит следующее число, а не то же самое.
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith({
      where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'invoice' } },
      create: { companyId: 'co-A', year: 2026, kind: 'invoice', lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
    });
    // Прежних документов сервис даже не ищет — искать «кого бы заменить» и
    // было корнем `Д-4`.
    expect(tx.document.findFirst).not.toHaveBeenCalled();
    expect(tx.document.update).not.toHaveBeenCalled();
    expect(trace).toContain('counter');
  });

  it('`Д-3`: перевыпуск сохраняет номер, растит версию и не тратит счётчик', async () => {
    // Перевыпуск — это та же бумага с исправлением, а не новая. Номер обязан
    // остаться прежним: клиент уже сослался на него в платёжке.
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-5',
      version: 2,
      parentDocumentId: null,
    });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      extras: { reissueOfDocumentId: 'doc-old' },
    });

    expect(r).toEqual({ ok: true, documentId: 'doc-new', number: 'С-2026-5' });
    expect(createdData(tx)).toMatchObject({
      number: 'С-2026-5',
      version: 3,
      replacesDocumentId: 'doc-old',
    });
    // Счётчик не трогаем: иначе каждое исправление опечатки прожигало бы номер,
    // и в нумерации года появлялись бы дыры, за которые отвечать бухгалтерии.
    expect(tx.documentCounter.upsert).not.toHaveBeenCalled();
  });

  it('`Д-3`: прежняя версия гасится `supersededAt` ТОЙ ЖЕ транзакцией, что создаёт новую', async () => {
    // Порядок здесь — не придирка. Пометь мы прежнюю версию раньше и упади
    // запись — заказ остался бы вовсе без действующего документа. Пометь
    // позже — на секунду показались бы две живые версии одного номера.
    const { prisma, tx, trace, looseUpdate } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-5',
      version: 1,
      parentDocumentId: null,
    });

    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      extras: { reissueOfDocumentId: 'doc-old' },
    });

    expect(tx.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-old' },
      data: { supersededAt: NOW },
    });
    // Создание и гашение — внутри ОДНОЙ пары «начали–зафиксировали»: между
    // ними нет ни коммита, ни второй транзакции.
    expect(trace).toEqual([
      'tx:begin',
      'tx:commit',
      'tx:begin',
      'create',
      'supersede',
      'tx:commit',
    ]);
    // И это именно транзакционный клиент: обычным вызовом мимо транзакции
    // прежнюю версию никто не гасит.
    expect(looseUpdate).not.toHaveBeenCalled();
  });

  it('перевыпуск ищет прежнюю версию только среди живых и пронумерованных', async () => {
    // Заменённую версию перевыпускать нельзя (ветка раздвоится), безномерную —
    // не из чего: номер брать неоткуда. Оба условия — в запросе, а не в уме.
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-5',
      version: 1,
      parentDocumentId: null,
    });

    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      extras: { reissueOfDocumentId: 'doc-old' },
    });

    expect((tx.document.findFirst as Fn).mock.calls[0]![0].where).toEqual({
      id: 'doc-old',
      orderId: 'ord-1',
      type: 'invoice',
      number: { not: null },
      supersededAt: null,
    });
  });

  it('перевыпускать нечего (нет документа или он уже заменён) → reissue_not_found', async () => {
    // Молчаливый «новый номер» вместо отказа был бы худшим исходом: человек
    // думает, что исправил счёт, а у клиента их стало два.
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValue(null);

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      extras: { reissueOfDocumentId: 'doc-gone' },
    });

    expect(r).toEqual({ ok: false, error: 'reissue_not_found' });
    expect(tx.document.create).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('перевыпуск не отвязывает документ от его основания', async () => {
    // Основание в форме перевыпуска не переспрашивают, поэтому новая версия
    // наследует его от заменяемой: иначе акт перевыпуском потерял бы свой счёт.
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValue({
      id: 'doc-old',
      number: 'С-2026-5',
      version: 1,
      parentDocumentId: 'base-1',
    });

    await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      extras: { reissueOfDocumentId: 'doc-old' },
    });

    expect(createdData(tx)).toMatchObject({ parentDocumentId: 'base-1' });
  });
});

describe('`У-151`: ведомый тип нумеруется сам', () => {
  it('акт берёт свой номер из последовательности счёта, а связь держит parentDocumentId', async () => {
    // Раньше акт выдёргивал число из номера счёта и склеивал со своим
    // префиксом. Тогда два документа к одному основанию получали один номер
    // (`Д-4`), а акт января носил число прошлогоднего счёта с новым годом.
    const { prisma, tx } = makePrisma({ lastNumber: 8 });
    (tx.document.findFirst as Fn).mockResolvedValueOnce({
      id: 'inv-1',
      number: 'С-2026-3',
      createdAt: new Date('2026-02-01'),
    });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'act',
      now: NOW,
    });

    expect(r).toMatchObject({ ok: true, number: 'А-2026-8' });
    expect(createdData(tx)).toMatchObject({ parentDocumentId: 'inv-1', version: 1 });
    // Счёт и акт делят одну последовательность — по решению заказчика.
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'invoice' } },
      })
    );
  });

  it('доп. соглашение берёт номер из последовательности договора', async () => {
    const { prisma, tx } = makePrisma({ lastNumber: 4 });
    (tx.document.findFirst as Fn).mockResolvedValueOnce({
      id: 'contract-1',
      number: 'Д-2026-2',
      createdAt: new Date('2026-03-01'),
    });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'extra_agreement',
      now: NOW,
    });

    // Своё число, а не число договора: иначе два ДС к одному договору были бы
    // неразличимы по номеру.
    expect(r).toMatchObject({ ok: true, number: 'ДС-2026-4' });
    expect(createdData(tx)).toMatchObject({ parentDocumentId: 'contract-1' });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'contract' } },
      })
    );
  });

  it('`Д-5`: основание без номера (пришло из 1С) → leader_number_required, а не invoice_required', async () => {
    // Счёт на экране есть, а система отвечала «сначала выпустите счёт» —
    // человек шёл искать несуществующую проблему. Честный ответ: у основания
    // нет номера, впишите его.
    const { prisma, tx } = makePrisma();
    (tx.document.findFirst as Fn).mockResolvedValueOnce({
      id: 'inv-1c',
      number: null,
      createdAt: new Date('2026-02-01'),
    });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'act',
      now: NOW,
    });

    expect(r).toEqual({ ok: false, error: 'leader_number_required' });
    expect(uploadMock).not.toHaveBeenCalled();
  });
});

describe('`У-151`: занятый номер и год по Москве', () => {
  it('номер уже занят → number_taken ДО рендера и загрузки файла', async () => {
    // Проверка стоит раньше дорогих шагов: рендер PDF и загрузка в хранилище
    // ради заведомо отказного выпуска — потраченные секунды и файл-сирота.
    const { prisma, tx, clashFindFirst } = makePrisma({ clash: { id: 'doc-same-number' } });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
    });

    expect(r).toEqual({ ok: false, error: 'number_taken' });
    expect(renderMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(tx.document.create).not.toHaveBeenCalled();
    // Ищем по «эффективной компании»: у документа заказа компания лежит в
    // заказе, у документа без заказа — в самом документе. Одного поля мало —
    // иначе проверка молча ничего бы не проверяла.
    expect(clashFindFirst.mock.calls[0]![0].where).toEqual({
      OR: [{ companyId: 'co-A' }, { order: { companyId: 'co-A' } }],
      type: 'invoice',
      number: 'С-2026-7',
      version: 1,
    });
  });

  it('`Д-22`: год номера считается по Europe/Moscow, а не по часовому поясу сервера', async () => {
    // 31 декабря 22:30 UTC в Москве — уже 1 января следующего года. На
    // UTC-сервере такой счёт попадал в счётчик ПРОШЛОГО года и получал номер,
    // который там уже занят: два документа с одним номером в разных годах.
    const { prisma, tx } = makePrisma({ lastNumber: 1 });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: new Date('2025-12-31T22:30:00Z'),
    });

    expect(r).toMatchObject({ ok: true, number: 'С-2026-1' });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_kind: { companyId: 'co-A', year: 2026, kind: 'invoice' } },
      })
    );
    // Явная страховка от возврата дефекта: московского 2026-го, а не UTC-2025.
    expect(createdData(tx).number).toBe('С-2026-1');
    expect(createdData(tx).number).not.toContain('2025');
  });

  it('год берётся по ДАТЕ ДОКУМЕНТА (тоже по Москве), а не по моменту выпуска', async () => {
    // Документ можно выпустить «задним» или «передним» числом — в номере
    // должен стоять год той даты, что напечатана на бумаге.
    const { prisma, tx } = makePrisma({ lastNumber: 3 });

    const r = await generateOrderDocument(prisma, manager(), {
      orderId: 'ord-1',
      docType: 'invoice',
      now: NOW,
      // В Москве это уже 1 января 2027 года.
      extras: { documentDate: new Date('2026-12-31T21:00:00Z') },
    });

    expect(r).toMatchObject({ ok: true, number: 'С-2027-3' });
    expect(tx.documentCounter.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId_year_kind: { companyId: 'co-A', year: 2027, kind: 'invoice' } },
      })
    );
  });
});
