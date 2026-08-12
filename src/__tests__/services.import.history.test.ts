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
  const auto = vi.fn().mockResolvedValue([
    {
      id: 'a1',
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
      entity: 'organization',
      operation: 'pull',
      status: 'success',
      payload: { created: 2 },
    },
  ]);
  return {
    prisma: {
      oneCImportBatch: { findMany: excel },
      paymentImportBatch: { findMany: statement },
      syncLog: { findMany: auto },
      ...over,
    } as never,
    excel,
    statement,
    auto,
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

  it('три канала в одном списке, свежие сверху', async () => {
    const { prisma } = db();
    const res = await listExchangeHistory(prisma, session);
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement', 'excel', 'auto']);
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
  });

  it('фильтр по каналу спрашивает только нужную таблицу', async () => {
    const { prisma, excel, statement, auto } = db();
    const res = await listExchangeHistory(prisma, session, { channel: 'statement' });
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement']);
    expect(statement).toHaveBeenCalled();
    expect(excel).not.toHaveBeenCalled();
    expect(auto).not.toHaveBeenCalled();
  });

  it('руководителю: только своя компания и БЕЗ автообмена (в SyncLog нет компании)', async () => {
    importScope.mockReturnValue({ kind: 'company', companyId: 'c1' });
    const { prisma, excel, statement, auto } = db();
    const res = await listExchangeHistory(prisma, session);
    if (!res.ok) throw new Error('expected ok');

    expect(res.items.map((i) => i.channel)).toEqual(['statement', 'excel']);
    expect(auto).not.toHaveBeenCalled();
    expect(excel.mock.calls[0]![0].where).toEqual({ companyId: 'c1' });
    expect(statement.mock.calls[0]![0].where).toEqual({ companyId: 'c1' });
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
      statement: 'Выписка (сч. 51)',
      auto: 'Автообмен',
    });
  });
});
