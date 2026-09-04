import { describe, it, expect, vi, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * `У-173` — файловый канал выгрузки документов в 1С (этап 8, PR-9).
 *
 * Сервис собирает ZIP: `documents.xlsx` (листы «Документы», «Строки»,
 * «Не вошли») и `files/*.pdf`. Здесь — на подставной Prisma и хранилище:
 * кто может собирать пакет, что в него попадает, что пропускается и почему,
 * как документы помечаются «выгружен файлом», что уходит в историю и журнал.
 * Архив и Excel читаются обратно теми же библиотеками — проверяется
 * содержимое, а не факт вызова.
 */

const { writeSyncLog, recordAudit, download } = vi.hoisted(() => ({
  writeSyncLog: vi.fn(),
  recordAudit: vi.fn(),
  download: vi.fn(),
}));
vi.mock('@/lib/services/oneCSync/log', () => ({ writeSyncLog }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));
vi.mock('@/lib/storage', () => ({ getObjectStorage: () => ({ download }) }));

import { log } from '@/lib/logging';
import {
  EXPORT_PACKAGE_LIMIT,
  buildExportPackage,
  listExportCandidates,
  parseExportPackageFilter,
} from '@/lib/services/oneCSync/exportPackage';

const admin = { sub: 'u-admin', role: 'admin', name: 'Админ' } as SessionPayload;
const leader = {
  sub: 'u-lead',
  role: 'leader',
  companyId: 'co-1',
  name: 'Руководитель',
} as SessionPayload;
/** Рядовой менеджер — охват «свои организации», канала у него нет. */
const manager = { sub: 'u-m', role: 'manager', companyId: 'co-1' } as SessionPayload;

const dec = (n: number) => ({ toNumber: () => n });

const baseDoc = {
  id: 'doc-1',
  type: 'invoice',
  number: 'С-1',
  name: 'invoice-v1-abc.pdf',
  version: 1,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  path: 'documents/doc-1.pdf',
  supersededAt: null,
  replacesDocumentId: null,
  counterpartyType: 'organization',
  counterpartyId: 'org-1',
  companyId: 'co-1',
  uploadedById: 'user-1',
  oneCPushStatus: 'none',
  oneCPushedVersion: null,
  oneCExternalId: null,
  amountNet: dec(100),
  amountVat: dec(20),
  amountGross: dec(120),
  order: null,
  parentDocument: null,
  lines: [],
};
type Doc = typeof baseDoc & Record<string, unknown>;
const doc = (over: Record<string, unknown> = {}): Doc => ({ ...baseDoc, ...over });

type Counterparty = {
  id: string;
  inn: string | null;
  kpp: string | null;
  name: string;
  legalName: string | null;
};
const org: Counterparty = {
  id: 'org-1',
  inn: '7707083893',
  kpp: null,
  name: 'Орг',
  legalName: null,
};
const partner: Counterparty = {
  id: 'p-1',
  inn: '5001000000',
  kpp: '500101001',
  name: 'Партнёр',
  legalName: 'ООО «Партнёр»',
};

function makePrisma(docs: Doc[], opts: { orgs?: Counterparty[]; partners?: Counterparty[] } = {}) {
  const orgs = opts.orgs ?? [org];
  const partners = opts.partners ?? [partner];
  const byId = (list: Counterparty[]) =>
    vi.fn(
      async ({ where }: { where: { id: string } }) => list.find((c) => c.id === where.id) ?? null
    );
  const byIds = (list: Counterparty[]) =>
    vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      list.filter((c) => where.id.in.includes(c.id))
    );
  return {
    document: {
      findMany: vi.fn(async () => docs),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        replacesDocumentId: null,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    organization: { findMany: byIds(orgs), findUnique: byId(orgs) },
    partner: { findMany: byIds(partners), findUnique: byId(partners) },
  } as unknown as PrismaClient & {
    document: Record<'findMany' | 'findUniqueOrThrow' | 'updateMany', ReturnType<typeof vi.fn>>;
    organization: Record<'findMany' | 'findUnique', ReturnType<typeof vi.fn>>;
    partner: Record<'findMany' | 'findUnique', ReturnType<typeof vi.fn>>;
  };
}

async function unpack(zip: Buffer) {
  const archive = await JSZip.loadAsync(zip);
  const names = Object.keys(archive.files)
    .filter((n) => !archive.files[n].dir)
    .sort();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await archive.file('documents.xlsx')!.async('nodebuffer')) as never);
  // `row.values` у exceljs — с единицы; первый элемент пустой.
  const rows = (sheet: string) => {
    const ws = wb.getWorksheet(sheet)!;
    const out: unknown[][] = [];
    ws.eachRow((row) => out.push((row.values as unknown[]).slice(1)));
    return out;
  };
  return { archive, names, rows };
}

beforeEach(() => {
  vi.clearAllMocks();
  writeSyncLog.mockResolvedValue({ id: 'log-1' });
  recordAudit.mockResolvedValue(undefined);
  download.mockResolvedValue(Buffer.from('%PDF-1.4 stub'));
});

describe('parseExportPackageFilter — фильтр из адресной строки', () => {
  it('даты, тип и статус разбираются; всё — начало дня UTC', () => {
    expect(
      parseExportPackageFilter({
        from: '2026-09-01',
        to: '2026-09-03',
        type: 'act',
        oneCPushStatus: 'failed',
      })
    ).toEqual({
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-03T00:00:00Z'),
      type: 'act',
      oneCPushStatus: 'failed',
    });
  });

  it('пустая строка запроса — фильтр без единого ключа', () => {
    expect(parseExportPackageFilter({})).toEqual({
      from: undefined,
      to: undefined,
      type: undefined,
      oneCPushStatus: undefined,
    });
  });

  it('чужие слова — «без фильтра», а не ошибка: кривая дата, несуществующий месяц, КП, левый статус', () => {
    expect(
      parseExportPackageFilter({
        from: '01.09.2026',
        to: '2026-13-45',
        type: 'commercial_proposal',
        oneCPushStatus: 'whatever',
      })
    ).toEqual({ from: undefined, to: undefined, type: undefined, oneCPushStatus: undefined });
    expect(parseExportPackageFilter({ from: '', type: '' }).from).toBeUndefined();
  });
});

describe('listExportCandidates — что войдёт в пакет', () => {
  it('рядовому менеджеру канала нет: forbidden, база не читается', async () => {
    const prisma = makePrisma([doc()]);
    expect(await listExportCandidates(prisma, manager)).toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
  });

  it('админ видит все компании: where без companyId, только выгружаемые типы, действующие версии, не из 1С', async () => {
    const prisma = makePrisma([]);
    const res = await listExportCandidates(prisma, admin);
    expect(res).toEqual({ ok: true, items: [], ready: 0, truncated: false });
    expect(prisma.document.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          type: { in: ['invoice', 'act', 'contract', 'extra_agreement'] },
          supersededAt: null,
          externalId: null,
          createdAt: {},
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: EXPORT_PACKAGE_LIMIT + 1,
      })
    );
  });

  it('руководитель — только своя компания; фильтр по датам, типу и статусу ложится в where', async () => {
    const prisma = makePrisma([]);
    await listExportCandidates(prisma, leader, {
      from: new Date('2026-09-01T00:00:00Z'),
      to: new Date('2026-09-03T00:00:00Z'),
      type: 'act',
      oneCPushStatus: 'failed',
    });
    expect(prisma.document.findMany.mock.calls[0][0].where).toEqual({
      companyId: 'co-1',
      type: 'act',
      supersededAt: null,
      externalId: null,
      oneCPushStatus: 'failed',
      // «по 3 сентября включительно» = строго до полуночи 4-го.
      createdAt: { gte: new Date('2026-09-01T00:00:00Z'), lt: new Date('2026-09-04T00:00:00Z') },
    });
  });

  it('контрагенты грузятся пачкой: организации и партнёры двумя запросами, документ без контрагента не ищется', async () => {
    const prisma = makePrisma([
      doc({ id: 'd-org' }),
      doc({ id: 'd-partner', counterpartyType: 'partner', counterpartyId: 'p-1' }),
      doc({ id: 'd-none', counterpartyType: null, counterpartyId: null }),
    ]);
    const res = await listExportCandidates(prisma, admin);
    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['org-1'] } },
      select: { id: true, name: true, inn: true },
    });
    expect(prisma.partner.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['p-1'] } },
      select: { id: true, name: true, inn: true },
    });
    expect(res.ok && res.items.map((i) => [i.id, i.counterpartyName, i.blocked])).toEqual([
      ['d-org', 'Орг', null],
      ['d-partner', 'Партнёр', null],
      ['d-none', null, 'counterparty_without_inn'],
    ]);
  });

  it('причины блокировки — как у сетевой выгрузки: сначала ИНН, потом номер; ready считает только чистые', async () => {
    const prisma = makePrisma(
      [
        doc({ id: 'ok', version: 2 }),
        doc({ id: 'no-inn', counterpartyId: 'org-noinn' }),
        doc({ id: 'no-number', number: null }),
        doc({ id: 'both', number: null, counterpartyId: 'org-noinn' }),
      ],
      { orgs: [org, { ...org, id: 'org-noinn', inn: null }] }
    );
    const res = await listExportCandidates(prisma, admin);
    expect(res).toEqual({
      ok: true,
      truncated: false,
      ready: 1,
      items: [
        expect.objectContaining({
          id: 'ok',
          type: 'invoice',
          number: 'С-1',
          name: 'invoice-v1-abc.pdf',
          createdAt: baseDoc.createdAt,
          version: 2,
          counterpartyName: 'Орг',
          oneCPushStatus: 'none',
          blocked: null,
        }),
        expect.objectContaining({ id: 'no-inn', blocked: 'counterparty_without_inn' }),
        expect.objectContaining({ id: 'no-number', blocked: 'no_number' }),
        expect.objectContaining({ id: 'both', blocked: 'counterparty_without_inn' }),
      ],
    });
  });

  it('больше лимита — truncated: true, отдаются первые EXPORT_PACKAGE_LIMIT', async () => {
    const docs = Array.from({ length: EXPORT_PACKAGE_LIMIT + 1 }, (_, i) => doc({ id: `d-${i}` }));
    const res = await listExportCandidates(makePrisma(docs), admin);
    expect(res.ok && res.items.length).toBe(EXPORT_PACKAGE_LIMIT);
    expect(res.ok && res.truncated).toBe(true);
    expect(res.ok && res.ready).toBe(EXPORT_PACKAGE_LIMIT);
  });
});

describe('buildExportPackage — сборка ZIP', () => {
  it('рядовому менеджеру — forbidden без обращения к базе и хранилищу', async () => {
    const prisma = makePrisma([doc()]);
    expect(await buildExportPackage(prisma, manager)).toEqual({ ok: false, error: 'forbidden' });
    expect(prisma.document.findMany).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('под фильтр никто не попал — empty; ничего не помечается, история и журнал молчат', async () => {
    const prisma = makePrisma([]);
    expect(await buildExportPackage(prisma, admin)).toEqual({ ok: false, error: 'empty' });
    expect(prisma.document.updateMany).not.toHaveBeenCalled();
    expect(writeSyncLog).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('все кандидаты заблокированы — тоже empty: пакет из одного листа «Не вошли» не собираем', async () => {
    const prisma = makePrisma([doc({ number: null })]);
    expect(await buildExportPackage(prisma, admin)).toEqual({ ok: false, error: 'empty' });
    expect(download).not.toHaveBeenCalled();
  });

  it('основной путь: Excel повторяет тело сетевой выгрузки, файлы лежат в files/, документы помечены, история и журнал записаны', async () => {
    const prisma = makePrisma([
      doc({
        id: 'doc-act',
        type: 'act',
        number: 'А-7',
        name: 'act-v2.pdf',
        version: 2,
        replacesDocumentId: 'doc-act-v1',
        counterpartyType: 'partner',
        counterpartyId: 'p-1',
        order: { externalId: '1c-order-9', orderNumber: 'З-9' },
        parentDocument: { id: 'doc-1', number: 'С-1', replacesDocumentId: null },
        lines: [
          {
            title: 'Обучение',
            quantity: dec(2),
            unit: 'person',
            unitPrice: dec(50),
            vatRate: dec(0.2),
            vatAmount: dec(20),
            amount: dec(120),
          },
          {
            title: 'Без НДС',
            quantity: dec(1),
            unit: 'service',
            unitPrice: dec(10),
            vatRate: null,
            vatAmount: dec(0),
            amount: dec(10),
          },
        ],
      }),
      // Legacy: без строк, без сумм, без заказа и основания.
      doc({ id: 'doc-1', amountNet: null, amountVat: null, amountGross: null }),
    ]);
    const before = Date.now();
    const res = await buildExportPackage(prisma, leader, {
      from: new Date('2026-09-01T00:00:00Z'),
      type: 'invoice',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.count).toBe(2);
    expect(res.skipped).toEqual([]);
    expect(res.fileName).toMatch(/^1c-documents-\d{4}-\d{2}-\d{2}\.zip$/);

    const { names, rows } = await unpack(res.zip);
    expect(names).toEqual([
      'documents.xlsx',
      'files/Акт А-7 от 01.09.2026.pdf',
      'files/Счёт С-1 от 01.09.2026.pdf',
    ]);
    expect(download).toHaveBeenCalledWith('documents/doc-1.pdf');

    const docsSheet = rows('Документы');
    expect(docsSheet[0]).toEqual([
      'Ключ (externalId)',
      'Тип (type)',
      'Номер (number)',
      'Дата (date)',
      'Версия (version)',
      'ИНН (counterparty.inn)',
      'КПП (counterparty.kpp)',
      'Контрагент (counterparty.name)',
      'Юр. название (counterparty.legalName)',
      'Заказ в 1С (order.externalId)',
      'Номер заказа (order.orderNumber)',
      'Основание (parentDocument.externalId)',
      'Номер основания (parentDocument.number)',
      'Без НДС (totals.net)',
      'НДС (totals.vat)',
      'Итого (totals.gross)',
      'Файл в архиве (file)',
    ]);
    // Перевыпуск уезжает корневым ключом цепочки — тем же, что у сетевой выгрузки.
    expect(docsSheet[1]).toEqual([
      'doc-act-v1',
      'act',
      'А-7',
      '2026-09-01T00:00:00.000Z',
      2,
      '5001000000',
      '500101001',
      'Партнёр',
      'ООО «Партнёр»',
      '1c-order-9',
      'З-9',
      'doc-1',
      'С-1',
      100,
      20,
      120,
      'Акт А-7 от 01.09.2026.pdf',
    ]);
    expect(docsSheet[2]?.slice(0, 6)).toEqual([
      'doc-1',
      'invoice',
      'С-1',
      '2026-09-01T00:00:00.000Z',
      1,
      '7707083893',
    ]);
    expect(docsSheet[2]?.[16]).toBe('Счёт С-1 от 01.09.2026.pdf');
    // Пустые ячейки legacy-документа: КПП, юр. название, заказ, основание, суммы.
    expect(docsSheet[2]?.slice(6, 16).filter(Boolean)).toEqual(['Орг']);

    const linesSheet = rows('Строки');
    expect(linesSheet).toEqual([
      [
        'Ключ документа (externalId)',
        'Номер документа (number)',
        'Наименование (title)',
        'Количество (quantity)',
        'Ед. (unit)',
        'Цена (price)',
        'Ставка НДС (vatRate)',
        'НДС (vatAmount)',
        'Сумма (amount)',
      ],
      ['doc-act-v1', 'А-7', 'Обучение', 2, 'чел.', 50, 0.2, 20, 120],
      expect.arrayContaining(['doc-act-v1', 'А-7', 'Без НДС', 1, 'услуга', 10, 0, 10]),
    ]);
    expect(rows('Не вошли')).toEqual([['Документ (id)', 'Номер', 'Почему']]);

    // Отметка «выгружен файлом» — по версиям; уже принятое по сети не понижается.
    expect(prisma.document.updateMany).toHaveBeenCalledTimes(2);
    const calls = prisma.document.updateMany.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          where: { id: { in: ['doc-act'] }, oneCPushStatus: { not: 'pushed' } },
          data: expect.objectContaining({
            oneCPushStatus: 'exported_file',
            oneCPushedVersion: 2,
            oneCPushError: null,
          }),
        },
        {
          where: { id: { in: ['doc-1'] }, oneCPushStatus: { not: 'pushed' } },
          data: expect.objectContaining({ oneCPushStatus: 'exported_file', oneCPushedVersion: 1 }),
        },
      ])
    );
    const pushedAt = calls[0].data.oneCPushedAt as Date;
    expect(pushedAt.getTime()).toBeGreaterThanOrEqual(before);

    // История обмена: канал «Документы → 1С», компания руководителя, фильтр как есть.
    expect(writeSyncLog).toHaveBeenCalledWith(
      {
        entity: 'document',
        direction: 'outbound',
        operation: 'export',
        status: 'success',
        payload: {
          companyId: 'co-1',
          actorUserId: 'u-lead',
          actorName: 'Руководитель',
          documents: 2,
          skipped: 0,
          skippedDocuments: [],
          filter: {
            from: '2026-09-01T00:00:00.000Z',
            to: null,
            type: 'invoice',
            oneCPushStatus: null,
          },
          documentIds: ['doc-act', 'doc-1'],
        },
        durationMs: expect.any(Number),
      },
      prisma
    );
    // Журнал: одно событие на пакет, ссылка — на запись истории.
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'u-lead',
      action: 'documents_exported_to_1c_file',
      entity: 'document',
      entityId: 'log-1',
      after: { documents: 2, skipped: 0, documentIds: ['doc-act', 'doc-1'] },
    });
  });

  it('пропуски не роняют пакет: без ИНН, без номера, файл не скачался — лист «Не вошли», status warn', async () => {
    const error = vi.spyOn(log, 'error').mockImplementation(() => {});
    download
      .mockRejectedValueOnce(new Error('NoSuchKey'))
      .mockRejectedValueOnce('boom')
      .mockResolvedValue(Buffer.from('pdf'));
    const prisma = makePrisma(
      [
        doc({ id: 'lost-1', number: 'С-11' }),
        doc({ id: 'lost-2', number: 'С-12' }),
        doc({ id: 'no-inn', number: 'С-13', counterpartyId: 'org-noinn' }),
        doc({ id: 'no-number', number: null }),
        doc({ id: 'fine', number: 'С-14', oneCPushStatus: 'failed' }),
      ],
      { orgs: [org, { ...org, id: 'org-noinn', inn: null }] }
    );
    const res = await buildExportPackage(prisma, admin, { to: new Date('2026-09-03T00:00:00Z') });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.count).toBe(1);
    expect(res.skipped).toEqual([
      { documentId: 'lost-1', number: 'С-11', reason: 'file_unavailable' },
      { documentId: 'lost-2', number: 'С-12', reason: 'file_unavailable' },
      { documentId: 'no-inn', number: 'С-13', reason: 'counterparty_without_inn' },
      { documentId: 'no-number', number: null, reason: 'no_number' },
    ]);
    expect(error).toHaveBeenCalledWith('[buildExportPackage] file download failed', {
      documentId: 'lost-1',
      error: 'NoSuchKey',
    });
    expect(error).toHaveBeenCalledWith('[buildExportPackage] file download failed', {
      documentId: 'lost-2',
      error: 'boom',
    });

    const { names, rows } = await unpack(res.zip);
    expect(names).toEqual(['documents.xlsx', 'files/Счёт С-14 от 01.09.2026.pdf']);
    const missed = rows('Не вошли');
    expect(missed.slice(0, 4)).toEqual([
      ['Документ (id)', 'Номер', 'Почему'],
      ['lost-1', 'С-11', 'Файл документа не найден в хранилище — в пакет не вошёл.'],
      ['lost-2', 'С-12', 'Файл документа не найден в хранилище — в пакет не вошёл.'],
      ['no-inn', 'С-13', expect.stringContaining('ИНН')],
    ]);
    // Без номера — ячейка номера пустая.
    expect(missed[4]?.[0]).toBe('no-number');
    expect(missed[4]?.[1]).toBeFalsy();
    expect(missed[4]?.[2]).toContain('номер');

    // Помечен только тот, кто реально уехал.
    expect(prisma.document.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.document.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['fine'] });
    expect(writeSyncLog).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'warn',
        payload: expect.objectContaining({
          companyId: null,
          actorName: 'Админ',
          documents: 1,
          skipped: 4,
          filter: { from: null, to: '2026-09-03T00:00:00.000Z', type: null, oneCPushStatus: null },
        }),
      }),
      prisma
    );
    error.mockRestore();
  });

  it('одинаковые имена файлов в архиве получают суффикс « (2)», « (3)» перед расширением', async () => {
    const prisma = makePrisma([
      doc({ id: 'a' }),
      doc({ id: 'b', name: 'other.pdf' }),
      doc({ id: 'c', name: 'third.pdf' }),
    ]);
    const res = await buildExportPackage(prisma, admin, { oneCPushStatus: 'none' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { names, rows } = await unpack(res.zip);
    expect(names).toEqual([
      'documents.xlsx',
      'files/Счёт С-1 от 01.09.2026 (2).pdf',
      'files/Счёт С-1 от 01.09.2026 (3).pdf',
      'files/Счёт С-1 от 01.09.2026.pdf',
    ]);
    expect(
      rows('Документы')
        .slice(1)
        .map((r) => r[16])
    ).toEqual([
      'Счёт С-1 от 01.09.2026.pdf',
      'Счёт С-1 от 01.09.2026 (2).pdf',
      'Счёт С-1 от 01.09.2026 (3).pdf',
    ]);
    // Одна версия у всех — одна updateMany на троих.
    expect(prisma.document.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.document.updateMany.mock.calls[0][0].where.id).toEqual({ in: ['a', 'b', 'c'] });
    expect(writeSyncLog.mock.calls[0][0].payload.filter.oneCPushStatus).toBe('none');
  });

  it('сессия без имени — actorName: null', async () => {
    const nameless = { sub: 'u-admin', role: 'admin' } as SessionPayload;
    const res = await buildExportPackage(makePrisma([doc()]), nameless);
    expect(res.ok).toBe(true);
    expect(writeSyncLog.mock.calls[0][0].payload.actorName).toBeNull();
  });
});
