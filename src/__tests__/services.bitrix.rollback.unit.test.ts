import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/**
 * Откат пакета миграции из Битрикс24 (`У-196`, спека §3.6) — краевые случаи,
 * до которых живая база не доходит.
 *
 * Сосед [services.bitrix.rollback.integration.test.ts] гоняет откат на
 * настоящем Postgres и проверяет счастливые пути. Здесь — ровно то, что на
 * живой базе не воспроизвести: недоступная очередь, упавшая транзакция порции
 * и испорченный снимок `before` в журнале. Всё это реальные состояния
 * продакшена (Redis моргнул, внешний ключ не пустил удаление, старая строка
 * журнала записана не картой), и поведение отката в них — не мелочь: от него
 * зависит, залипнет ли пакет в «откатываем» навсегда и потеряется ли работа
 * сотни соседних строк из-за одной.
 *
 * Prisma — обычный объект с нужными методами: живой Postgres увёл бы файл в
 * integration-слой (§6 CLAUDE.md).
 */
const { getQueue, queueAdd } = vi.hoisted(() => {
  // `add` обязан возвращать обещание: боевой код его ждёт.
  const queueAdd = vi.fn(async () => undefined);
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

const { logError, bestEffort } = vi.hoisted(() => ({
  logError: vi.fn(),
  bestEffort: vi.fn(() => () => {}),
}));
vi.mock('@/lib/logging', () => ({
  bestEffort,
  log: { error: logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { requestRollback, rollbackStateOf, runRollback } from '@/lib/services/bitrix/rollback';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { BitrixEntity } from '@/lib/services/bitrix/mapping/types';

const DAY = 24 * 60 * 60 * 1000;
const admin = { sub: 'u1', role: 'admin', companyId: 'c1' } as SessionPayload;

/** Строка журнала `BitrixImportWrite` — вход отката. */
type Row = {
  id: string;
  entity: BitrixEntity;
  entityId: string;
  bitrixId: string;
  action: 'created' | 'updated' | 'linked';
  before: unknown;
  after: unknown;
  reverted: boolean;
};

/** «База» журнала: мок `findMany` фильтрует и режет её страницами. */
let journal: Row[];
/** Записи, которых в базе больше нет (их «обновление» возвращать некуда). */
let missing: Set<string>;
/** Записи, на которых падает удаление, и чем именно оно падает. */
let failing: Map<string, unknown>;
let seq = 0;

/** Кладёт строку в журнал; всё, что не указано, берётся по умолчанию. */
function put(over: Partial<Row>): Row {
  seq += 1;
  const row: Row = {
    id: `w${seq}`,
    entity: 'task',
    entityId: `e${seq}`,
    bitrixId: `B${seq}`,
    action: 'created',
    before: {},
    after: {},
    reverted: false,
    ...over,
  };
  journal.push(row);
  return row;
}

/**
 * Делегат таблицы. Один `findMany` обслуживает два разных запроса отката:
 * «жива ли запись» (узкий `select: { id: true }`) и «что на ней висит»
 * (`select` с `_count`). Различаем по форме запроса — как различает их база.
 */
function delegate() {
  return {
    findMany: vi.fn(async (args: any) => {
      // Запрос конфликтов: в юните на перенесённых строках чужой работы нет.
      if (args?.select?._count) return [];
      const ids: string[] = args?.where?.id?.in ?? [];
      return ids.filter((id) => !missing.has(id)).map((id) => ({ id }));
    }),
    deleteMany: vi.fn(async (args: any) => {
      const ids: string[] = args?.where?.id?.in ?? [];
      const bad = ids.find((id) => failing.has(id));
      if (bad !== undefined) throw failing.get(bad);
      return { count: ids.length };
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async () => ({})),
    count: vi.fn(async () => 0),
  };
}

type Tx = ReturnType<typeof makeTx>;
let tx: Tx;

function makeTx() {
  return {
    organization: delegate(),
    contact: delegate(),
    lead: delegate(),
    deal: delegate(),
    task: delegate(),
    order: delegate(),
    document: { ...delegate(), groupBy: vi.fn(async () => []) },
    dealNote: delegate(),
    organizationNote: delegate(),
    bitrixImportWrite: {
      updateMany: vi.fn(async (args: any) => {
        const ids: string[] = args?.where?.id?.in ?? [];
        for (const row of journal) if (ids.includes(row.id)) row.reverted = true;
        return { count: ids.length };
      }),
    },
  };
}

type Db = ReturnType<typeof makeDb>;
let db: Db;

function makeDb() {
  return {
    bitrixImportBatch: {
      findUnique: vi.fn(async () => ({
        id: 'b1',
        companyId: 'c1',
        status: 'applied',
        appliedAt: new Date(Date.now() - DAY),
      })),
      update: vi.fn(async () => ({})),
    },
    bitrixImportWrite: {
      count: vi.fn(async () => 3),
      // Страницы журнала. Пустой массив, когда строк больше нет, — иначе
      // цикл отката не кончится.
      findMany: vi.fn(async (args: any) => {
        const entity: BitrixEntity = args.where.entity;
        const skip: number = args.skip ?? 0;
        const take: number = args.take;
        return journal
          .filter((r) => r.entity === entity && !r.reverted)
          .slice(skip, skip + take)
          .map((r) => ({
            id: r.id,
            entity: r.entity,
            entityId: r.entityId,
            bitrixId: r.bitrixId,
            action: r.action,
            before: r.before,
            after: r.after,
          }));
      }),
    },
    $transaction: vi.fn(async (cb: (t: Tx) => Promise<unknown>) => cb(tx)),
  };
}

/** Мок в том виде, в каком его ждёт сигнатура сервиса. */
const asPrisma = (): PrismaClient => db as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  journal = [];
  missing = new Set();
  failing = new Map();
  seq = 0;
  tx = makeTx();
  db = makeDb();
});

describe('rollbackStateOf — пакет в работе', () => {
  // Подпись «возвращать нечего» рядом со строкой «Применяем» противоречила бы
  // сама себе: применение как раз и записывает то, что потом возвращают.
  it('статус «применяем» — это «в работе», а не «не применён»', () => {
    expect(
      rollbackStateOf(
        { status: 'applying', appliedAt: new Date('2026-09-01T00:00:00Z') },
        Date.parse('2026-09-02T00:00:00Z'),
        5
      )
    ).toBe('in_progress');
  });

  it('статус «откатываем» — тоже «в работе»', () => {
    expect(rollbackStateOf({ status: 'rolling_back', appliedAt: null }, Date.now(), 0)).toBe(
      'in_progress'
    );
  });

  // Дата применения появляется в конце применения, а статус — в начале.
  // Пакет, упавший посередине, не должен выглядеть «непримененным».
  it('«применяем» без даты применения — всё равно «в работе»', () => {
    expect(rollbackStateOf({ status: 'applying', appliedAt: null }, Date.now(), 0)).toBe(
      'in_progress'
    );
  });
});

describe('requestRollback — очередь недоступна', () => {
  it('задача не поставлена → ошибка «queue», и пакет НЕ залипает в «откатываем»', async () => {
    queueAdd.mockRejectedValueOnce(new Error('redis недоступен'));

    await expect(requestRollback(asPrisma(), admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'queue',
    });

    // Самое важное: статус остался прежним. Поменяй его раньше постановки — и
    // кнопка «Откатить» умрёт навсегда, а откатывать будет некому.
    expect(db.bitrixImportBatch.update).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith('[bitrix/rollback] задача отката не поставлена', {
      batchId: 'b1',
      error: 'redis недоступен',
    });
  });

  it('очередь бросила не-ошибку → в журнал уходит её текстовый вид', async () => {
    queueAdd.mockRejectedValueOnce('очередь легла');

    await expect(requestRollback(asPrisma(), admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'queue',
    });
    expect(logError).toHaveBeenCalledWith('[bitrix/rollback] задача отката не поставлена', {
      batchId: 'b1',
      error: 'очередь легла',
    });
    expect(db.bitrixImportBatch.update).not.toHaveBeenCalled();
  });
});

describe('runRollback — испорченный снимок в журнале', () => {
  it('`before` не карта → строку помечаем откаченной, но ничего не пишем', async () => {
    // Массив вместо карты: снимок «до» есть, а полей в нём нет.
    put({ entity: 'deal', action: 'updated', before: [] });
    // Нормальная строка рядом: она обязана откатиться как ни в чём не бывало.
    const good = put({
      entity: 'deal',
      action: 'updated',
      before: { title: 'Прежнее название' },
    });

    const summary = await runRollback(asPrisma(), 'b1');

    // Писать по пустому снимку нечего — зовём `update` ровно один раз.
    expect(tx.deal.update).toHaveBeenCalledTimes(1);
    expect(tx.deal.update).toHaveBeenCalledWith({
      where: { id: good.entityId },
      data: { title: 'Прежнее название' },
    });
    expect(summary.restored).toBe(1);
    // Обе строки уходят из журнала: испорченную нечем вернуть, и оставлять её
    // «неоткаченной» значило бы крутить её в каждом следующем запуске.
    expect(summary.reverted).toBe(2);
    expect(journal.filter((r) => r.reverted)).toHaveLength(2);
    expect(summary.status).toBe('rolled_back');
  });

  it('снимок «до» без единого известного поля → `update` не зовём вовсе', async () => {
    // Поля есть, но ни одного из белого списка: писать в базу нечего.
    put({ entity: 'deal', action: 'updated', before: { чужоеПоле: 'x' } });

    const summary = await runRollback(asPrisma(), 'b1');

    expect(tx.deal.update).not.toHaveBeenCalled();
    expect(summary.restored).toBe(0);
    expect(summary.reverted).toBe(1);
    expect(summary.status).toBe('rolled_back');
  });

  it('связь снимаем только по строковому `dealId`, остальные снимки пропускаем', async () => {
    const ours = put({
      entity: 'order',
      action: 'linked',
      before: { dealId: 'd-1', orderId: null },
    });
    put({ entity: 'order', action: 'linked', before: {} });
    put({ entity: 'order', action: 'linked', before: { dealId: 42 } });
    put({ entity: 'order', action: 'linked', before: null });
    put({ entity: 'order', action: 'linked', before: 'сломанный снимок' });

    const summary = await runRollback(asPrisma(), 'b1');

    // Ровно одна попытка снять связь — по единственному годному снимку.
    expect(tx.deal.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.deal.updateMany).toHaveBeenCalledWith({
      where: { id: 'd-1', orderId: ours.entityId },
      data: { orderId: null },
    });
    expect(summary.unlinked).toBe(1);
    // Негодные снимки не ошибка: возвращать по ним нечего, и держать их в
    // журнале вечно незачем.
    expect(summary.reverted).toBe(5);
    expect(summary.status).toBe('rolled_back');
  });
});

describe('runRollback — порция упала целиком', () => {
  it('повтор по одной: соседи откатываются, виноватая строка уходит в ошибки', async () => {
    const ok1 = put({ entity: 'task', action: 'created' });
    const bad = put({ entity: 'task', action: 'created' });
    const strange = put({ entity: 'task', action: 'created' });
    const ok2 = put({ entity: 'task', action: 'created' });
    // Внешний ключ не пускает удаление — так падает порция на живой базе.
    failing.set(bad.entityId, new Error('внешний ключ держит задачу'));
    // А так падает база, бросившая не-ошибку (драйвер, строка, что угодно).
    failing.set(strange.entityId, 'соединение потеряно');

    const summary = await runRollback(asPrisma(), 'b1');

    // Первая транзакция — вся порция, дальше по одной на каждую строку.
    expect(db.$transaction).toHaveBeenCalledTimes(1 + 4);
    // Три соседа не виноваты в одной сломанной строке и обязаны откатиться.
    expect(summary.deleted).toBe(2);
    expect(summary.reverted).toBe(2);
    expect(journal.filter((r) => r.reverted).map((r) => r.id)).toEqual([ok1.id, ok2.id]);
    // Ошибка остаётся при своей строке — человек увидит в отчёте, какую именно
    // строку Битрикса не удалось вернуть.
    expect(summary.errors).toEqual([
      { bitrixId: bad.bitrixId, entity: 'task', message: 'внешний ключ держит задачу' },
      { bitrixId: strange.bitrixId, entity: 'task', message: 'соединение потеряно' },
    ]);
    expect(summary.status).toBe('rollback_partial');
  });

  it('падение порции не мешает откатить следующую сущность', async () => {
    const badOrg = put({ entity: 'organization', action: 'created' });
    failing.set(badOrg.entityId, new Error('на организации висят заказы'));
    const okTask = put({ entity: 'task', action: 'created' });

    const summary = await runRollback(asPrisma(), 'b1');

    expect(journal.filter((r) => r.reverted).map((r) => r.id)).toEqual([okTask.id]);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toMatchObject({ entity: 'organization' });
    expect(summary.reverted).toBe(1);
    expect(summary.status).toBe('rollback_partial');
  });
});
