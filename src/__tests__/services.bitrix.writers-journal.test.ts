import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  snapshot,
  writeJournal,
  type ApplyContext,
  type Tx,
} from '@/lib/services/bitrix/writers/journal';

/**
 * Журнал записей пакета (`У-196`, спека §3.2): единственный способ откатить
 * перенос, поэтому пишется в одной транзакции со строкой и не глотает ошибок.
 *
 * Проверяется то, ради чего модуль написан: строка журнала несёт обязательные
 * поля, пустые снимки в неё не попадают (пустой `before` в `Json` неотличим от
 * «откатывать нечего», но занимает место и путает отчёт), а снимок приводит
 * даты и объекты к простым значениям — `Date` и `Decimal` в `Json` Prisma не
 * кладутся. Транзакция — объект с нужными методами: живой Postgres здесь не
 * нужен и увёл бы файл в integration-слой.
 */
const writeCreate = vi.fn();
const tx = { bitrixImportWrite: { create: writeCreate } } as unknown as Tx;

const ctx: ApplyContext = {
  batchId: 'b1',
  companyId: 'c1',
  importerId: 'u1',
  defaultManagerId: 'm1',
  lastAfter: () => null,
};

beforeEach(() => {
  vi.clearAllMocks();
  writeCreate.mockResolvedValue({ id: 'w1' });
});

describe('writeJournal', () => {
  it('пишет строку с обязательными полями', async () => {
    await writeJournal(tx, ctx, {
      entity: 'organization',
      entityId: 'o1',
      bitrixId: '101',
      action: 'created',
      after: { name: 'ООО «Альфа»', inn: null },
    });

    expect(writeCreate).toHaveBeenCalledTimes(1);
    expect(writeCreate).toHaveBeenCalledWith({
      data: {
        batchId: 'b1',
        entity: 'organization',
        entityId: 'o1',
        bitrixId: '101',
        action: 'created',
        after: { name: 'ООО «Альфа»', inn: null },
      },
    });
  });

  it('кладёт оба снимка, когда есть что откатывать', async () => {
    await writeJournal(tx, ctx, {
      entity: 'deal',
      entityId: 'd1',
      bitrixId: '501',
      action: 'updated',
      before: { title: 'Старое' },
      after: { title: 'Новое' },
    });

    expect(writeCreate.mock.calls[0][0].data).toMatchObject({
      before: { title: 'Старое' },
      after: { title: 'Новое' },
    });
  });

  it('снимки отвязаны от исходных объектов — правка после записи их не меняет', async () => {
    const after = { title: 'Новое' };
    await writeJournal(tx, ctx, {
      entity: 'deal',
      entityId: 'd1',
      bitrixId: '501',
      action: 'updated',
      after,
    });
    after.title = 'Изменили после записи';

    expect(writeCreate.mock.calls[0][0].data.after).toEqual({ title: 'Новое' });
  });

  it('НЕ кладёт `before`/`after`, когда их нет вовсе', async () => {
    await writeJournal(tx, ctx, {
      entity: 'order',
      entityId: 'ord-1',
      bitrixId: '501',
      action: 'linked',
    });

    const data = writeCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('before');
    expect(data).not.toHaveProperty('after');
  });

  it('НЕ кладёт пустые `before`/`after` — пустой объект в журнале ничего не значит', async () => {
    await writeJournal(tx, ctx, {
      entity: 'contact',
      entityId: 'k1',
      bitrixId: '301',
      action: 'updated',
      before: {},
      after: {},
    });

    const data = writeCreate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('before');
    expect(data).not.toHaveProperty('after');
  });
});

describe('snapshot', () => {
  it('дату превращает в строку ISO', () => {
    expect(snapshot({ wonAt: new Date('2026-01-01T10:00:00Z') })).toEqual({
      wonAt: '2026-01-01T10:00:00.000Z',
    });
  });

  it('строки, числа, логические значения и null оставляет как есть', () => {
    expect(snapshot({ name: 'ООО «Альфа»', size: 1024, archived: false, inn: null })).toEqual({
      name: 'ООО «Альфа»',
      size: 1024,
      archived: false,
      inn: null,
    });
  });

  it('пропускает `undefined` — «поля не передали» это не значение', () => {
    const out = snapshot({ name: 'ООО «Альфа»', kpp: undefined });

    expect(out).toEqual({ name: 'ООО «Альфа»' });
    expect(out).not.toHaveProperty('kpp');
  });

  it('всё прочее приводит к строке — `Decimal` и объекты в `Json` не кладутся', () => {
    const decimalLike = { toString: () => '120000.50' };

    expect(snapshot({ total: decimalLike, tags: ['a', 'b'], meta: { x: 1 } })).toEqual({
      total: '120000.50',
      tags: 'a,b',
      meta: '[object Object]',
    });
  });
});
