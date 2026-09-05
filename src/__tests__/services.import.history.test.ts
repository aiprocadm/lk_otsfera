import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Общая история обмена с 1С (`У-48`, этап 7).
 *
 * До этого история была только у Excel-канала: загрузив выписку, человек не мог
 * даже убедиться, что файл приняли. Здесь проверяется, что каналы сведены в
 * один список, скоуп руководителя не течёт и «отмену» мы обещаем только там,
 * где она есть.
 */
const { mayImportOneC } = vi.hoisted(() => ({ mayImportOneC: vi.fn(() => true) }));
vi.mock('@/lib/auth/managerPolicy', () => ({ mayImportOneC }));

const { importScope } = vi.hoisted(() => ({
  importScope: vi.fn((): { kind: string; companyId?: string } => ({ kind: 'all' })),
}));
vi.mock('@/lib/services/oneCSync/scope', () => ({ importScope }));

import { listExchangeHistory, CHANNEL_LABEL } from '@/lib/services/import/history';

const session = { sub: 'u1', role: 'admin' } as never;

function db(over: Record<string, unknown> = {}) {
  const excel = vi.fn().mockResolvedValue([
    {
      id: 'e1',
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      fileName: 'organizations.xlsx',
      status: 'committed',
      counts: { created: 3, updated: 1, skipped: 0 },
      importedBy: { name: 'Админ' },
      _count: { rows: 4 },
    },
  ]);
  const statement = vi.fn().mockResolvedValue([
    {
      id: 's1',
      createdAt: new Date('2026-08-11T10:00:00.000Z'),
      fileName: 'Карточка счета 51.xls',
      status: 'committed',
      counts: { totalRows: 327, imported: 129 },
      importedBy: { name: 'Бухгалтер' },
      _count: { writes: 129 },
    },
  ]);
  const autoRows = [
    {
      id: 'a1',
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
      entity: 'organization',
      operation: 'pull',
      status: 'success',
      payload: { created: 2 },
    },
  ];
  // `У-173`: пакет документов для 1С — та же таблица `SyncLog`, другой запрос
  // (исходящие записи по документам); мок различает их по `where`.
  const documentRows = [
    {
      id: 'd1',
      createdAt: new Date('2026-08-08T10:00:00.000Z'),
      status: 'warn',
      operation: 'export',
      errorMessage: null,
      payload: { companyId: 'c1', actorName: 'Бухгалтер', documents: 21, skipped: 2 },
    },
  ];
  const auto = vi.fn();
  const documents = vi.fn();
  const syncLog = vi.fn(async (args: { where: { direction?: unknown } }) => {
    if (args.where.direction === 'outbound') {
      documents(args);
      return documentRows;
    }
    auto(args);
    return autoRows;
  });
  const users = vi.fn().mockResolvedValue([]);
  return {
    prisma: {
      oneCImportBatch: { findMany: excel },
      paymentImportBatch: { findMany: statement },
      syncLog: { findMany: syncLog },
      user: { findMany: users },
      ...over,
    } as never,
    excel,
    statement,
    auto,
    documents,
    users,
  };
}

/** Запись `SyncLog` о попытке выгрузки документа по сети (`У-174`). */
function attempt(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    createdAt: new Date('2026-09-05T10:00:00.000Z'),
    status: 'error',
    operation: 'create',
    errorMessage: '1С: сервер вернул 500',
    payload: {
      documentId: 'doc-1',
      version: 1,
      type: 'act',
      number: 'А-7',
      companyId: 'c1',
      attempt: 2,
      actorUserId: 'u-7',
    },
    ...over,
  };
}

beforeEach(() => {
  mayImportOneC.mockReturnValue(true);
  importScope.mockReturnValue({ kind: 'all' });
});

describe('listExchangeHistory (У-48)', () => {
  it('без права импорта — forbidden, в базу не ходим', async () => {
    mayImportOneC.mockReturnValue(false);
    const { prisma, excel } = db();
    expect(await listExchangeHistory(prisma, session)).toEqual({ ok: false, error: 'forbidden' });
    expect(excel).not.toHaveBeenCalled();
  });

  it('четыре канала в одном списке, свежие сверху', async () => {
    const { prisma } = db();
    const res = await listExchangeHistory(prisma, session);
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement', 'excel', 'auto', 'documents']);
    expect(res.items[0]).toMatchObject({
      title: 'Карточка счета 51.xls',
      authorName: 'Бухгалтер',
      // `У-59`: у выписки откат такой же, как у Excel.
      rollback: 'available',
    });
    expect(res.items[1]!.rollback).toBe('available');
    expect(res.items[2]).toMatchObject({
      title: 'Организации · получение',
      authorName: null,
      rollback: 'unsupported',
    });
    // `У-173`: пакет для 1С — с числом документов по-русски и автором из payload.
    expect(res.items[3]).toMatchObject({
      id: 'd1',
      title: 'Пакет для 1С: 21 документ',
      authorName: 'Бухгалтер',
      status: 'warn',
      rollback: 'unsupported',
      counts: { documents: 21, skipped: 2 },
      detail: null,
    });
  });

  it('пакет для 1С без чисел в payload — «0 документов», а не падение', async () => {
    const { prisma } = db({
      syncLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'd0',
            createdAt: new Date(),
            status: 'success',
            operation: 'export',
            errorMessage: null,
            payload: null,
          },
        ]),
      },
    });
    const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items[0]).toMatchObject({ title: 'Пакет для 1С: 0 документов', authorName: null });
  });

  it('фильтр по каналу спрашивает только нужную таблицу', async () => {
    const { prisma, excel, statement, auto, documents } = db();
    const res = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement']);
    expect(statement).toHaveBeenCalled();
    expect(excel).not.toHaveBeenCalled();
    expect(auto).not.toHaveBeenCalled();
    expect(documents).not.toHaveBeenCalled();
  });

  it('руководителю: только своя компания и БЕЗ автообмена (в SyncLog нет компании)', async () => {
    importScope.mockReturnValue({ kind: 'company', companyId: 'c1' });
    const { prisma, excel, statement, auto, documents } = db();
    const res = await listExchangeHistory(prisma, session);
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement', 'excel', 'documents']);
    expect(auto).not.toHaveBeenCalled();
    expect(excel.mock.calls[0]![0].where).toEqual({ companyId: 'c1' });
    expect(statement.mock.calls[0]![0].where).toEqual({ companyId: 'c1' });
    // `У-173`/`У-174`: пакеты и попытки режутся по компании из payload записи.
    expect(documents.mock.calls[0]![0].where).toEqual({
      entity: 'document',
      direction: 'outbound',
      payload: { path: ['companyId'], equals: 'c1' },
    });
  });

  it('администратору пакеты документов всех компаний — без фильтра по payload', async () => {
    const { prisma, documents } = db();
    await listExchangeHistory(prisma, session, { channel: 'documents' });
    expect(documents.mock.calls[0]![0].where).toEqual({
      entity: 'document',
      direction: 'outbound',
    });
  });

  describe('У-174: попытки выгрузки документов по сети', () => {
    it('каждая попытка — своя строка: тип, номер, «попытка N», кто и что ответила 1С', async () => {
      const { prisma, users } = db({
        syncLog: { findMany: vi.fn().mockResolvedValue([attempt()]) },
      });
      users.mockResolvedValue([{ id: 'u-7', name: 'Менеджер Иванов' }]);
      const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
      if (!res.ok) throw new Error('expected ok');
      expect(res.items).toEqual([
        {
          id: 'p1',
          channel: 'documents',
          createdAt: '2026-09-05T10:00:00.000Z',
          title: 'Акт А-7 → 1С · попытка 2',
          authorName: 'Менеджер Иванов',
          status: 'error',
          rollback: 'unsupported',
          counts: null,
          detail: '1С: сервер вернул 500',
        },
      ]);
      // Имена — одним запросом по всем инициаторам, а не по одному на строку.
      expect(users).toHaveBeenCalledTimes(1);
      expect(users.mock.calls[0]![0].where).toEqual({ id: { in: ['u-7'] } });
    });

    it('успешная попытка — без подробностей; повтор той же версии — словами', async () => {
      const { prisma } = db({
        syncLog: {
          findMany: vi.fn().mockResolvedValue([
            attempt({ id: 'p2', status: 'success', operation: 'update', errorMessage: null }),
            attempt({
              id: 'p3',
              status: 'success',
              operation: 'skip',
              errorMessage: null,
              payload: {
                documentId: 'doc-1',
                type: 'invoice',
                number: 'С-1',
                reason: 'same_version',
              },
            }),
          ]),
        },
      });
      const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
      if (!res.ok) throw new Error('expected ok');
      expect(res.items[0]).toMatchObject({ title: 'Акт А-7 → 1С · попытка 2', detail: null });
      expect(res.items[1]).toMatchObject({
        title: 'Счёт С-1 → 1С',
        detail: 'Эта версия уже в 1С — повтор не нужен.',
      });
    });

    it('отказ (нет ИНН, нет номера) показывается русской строкой, а не кодом', async () => {
      const { prisma } = db({
        syncLog: {
          findMany: vi.fn().mockResolvedValue([
            attempt({
              id: 'p4',
              status: 'warn',
              operation: 'skip',
              errorMessage: 'counterparty_without_inn',
              payload: { documentId: 'doc-2', type: 'invoice', number: null, attempt: 1 },
            }),
            attempt({
              id: 'p5',
              status: 'warn',
              operation: 'skip',
              errorMessage: null,
              payload: { documentId: 'doc-3', type: 'contract', number: 'Д-1' },
            }),
          ]),
        },
      });
      const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
      if (!res.ok) throw new Error('expected ok');
      expect(res.items[0]).toMatchObject({
        title: 'Счёт без номера → 1С · попытка 1',
        detail: 'У контрагента не заполнен ИНН — заполните реквизиты и повторите выгрузку.',
      });
      expect(res.items[1]).toMatchObject({ title: 'Договор Д-1 → 1С', detail: null });
    });

    it('запись без payload (документ не найден) и без инициатора — «по расписанию», тип «Документ»', async () => {
      const { prisma, users } = db({
        syncLog: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              attempt({ id: 'p6', payload: null, errorMessage: 'Document not found' }),
            ]),
        },
      });
      const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
      if (!res.ok) throw new Error('expected ok');
      expect(res.items[0]).toMatchObject({
        title: 'Документ без номера → 1С',
        authorName: null,
        detail: 'Document not found',
      });
      // Некого искать — в таблицу пользователей не ходим.
      expect(users).not.toHaveBeenCalled();
    });

    it('инициатор, которого уже нет в базе, — «по расписанию», а не падение', async () => {
      const { prisma } = db({
        syncLog: { findMany: vi.fn().mockResolvedValue([attempt()]) },
      });
      const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
      if (!res.ok) throw new Error('expected ok');
      expect(res.items[0]!.authorName).toBeNull();
    });
  });

  it('рядовому менеджеру (скоуп orgs) пакеты документов не показываются', async () => {
    importScope.mockReturnValue({ kind: 'orgs' });
    const { prisma, documents } = db();
    const res = await listExchangeHistory(prisma, session, { channel: 'documents' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items).toEqual([]);
    expect(documents).not.toHaveBeenCalled();
  });

  it('старый батч Excel — отмена просрочена; уже откаченный — «уже отменён»', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const { prisma } = db({
      oneCImportBatch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            createdAt: old,
            fileName: 'a.xlsx',
            status: 'committed',
            counts: {},
            importedBy: null,
            _count: { rows: 2 },
          },
          {
            id: 'e2',
            createdAt: new Date(),
            fileName: 'b.xlsx',
            status: 'rolled_back',
            counts: {},
            importedBy: null,
            _count: { rows: 2 },
          },
        ]),
      },
    });
    const res = await listExchangeHistory(prisma, session, { channel: 'excel' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items.map((i) => i.rollback)).toEqual(['already_rolled_back', 'expired']);
    expect(res.items[0]!.authorName).toBeNull();
  });

  it('выписка без автора и одинаковые даты не ломают список', async () => {
    const same = new Date('2026-08-11T10:00:00.000Z');
    const { prisma } = db({
      paymentImportBatch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 's1',
            createdAt: same,
            fileName: 'a.xls',
            status: 'committed',
            counts: {},
            importedBy: null,
            _count: { writes: 1 },
          },
          {
            id: 's2',
            createdAt: same,
            fileName: 'b.xls',
            status: 'committed',
            counts: {},
            importedBy: null,
            _count: { writes: 1 },
          },
        ]),
      },
    });
    const res = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items.map((i) => i.authorName)).toEqual([null, null]);
    expect(res.items.map((i) => i.id)).toEqual(['s1', 's2']);
  });

  it('выписка без следа записи честно говорит «отменять нечего» (`У-59`)', async () => {
    // Так выглядят импорты, сделанные до появления отмены: система не помнит,
    // что именно они записали. Активная кнопка тут была бы обманом.
    const { prisma } = db({
      paymentImportBatch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 's-old',
            createdAt: new Date(),
            fileName: 'старая-выписка.xls',
            status: 'committed',
            counts: {},
            importedBy: null,
            _count: { writes: 0 },
          },
        ]),
      },
    });
    const res = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items[0]!.rollback).toBe('nothing_to_revert');
  });

  it('неизвестные сущность и операция автообмена показываются как есть, а не пустотой', async () => {
    const { prisma } = db({
      syncLog: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a2',
            createdAt: new Date('2026-08-09T10:00:00.000Z'),
            entity: 'widget',
            operation: 'sideload',
            status: 'warn',
            payload: null,
          },
        ]),
      },
    });
    const res = await listExchangeHistory(prisma, session, { channel: 'auto' });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items[0]!.title).toBe('widget · sideload');
  });

  it('лимит режет общий список после слияния каналов', async () => {
    const { prisma } = db();
    const res = await listExchangeHistory(prisma, session, { take: 2 });
    if (!res.ok) throw new Error('expected ok');
    expect(res.items).toHaveLength(2);
  });

  it('подписи каналов — по-русски (их видит человек)', () => {
    expect(CHANNEL_LABEL).toEqual({
      excel: 'Загрузка Excel',
      statement: 'Выписка по счёту 51',
      auto: 'Автообмен',
      documents: 'Документы → 1С',
    });
  });
});
