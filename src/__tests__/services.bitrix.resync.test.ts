/**
 * Еженедельный повтор переноса из Битрикс24 (`У-203`, спека §3.9).
 *
 * Повтор — сердце параллельного периода: две недели люди работают и в
 * Битрикс24, и в кабинете, и раз в неделю пакет повторяется сам. Проверяется
 * то, ради чего сервис написан: настройки берутся у ПОСЛЕДНЕГО применённого
 * пакета компании, картина прошлой недели (строки и находки) не наследуется —
 * иначе отчёт повтора врал бы, — и недоступная очередь не отменяет уже
 * заведённый пакет (§3 CLAUDE.md, degrade gracefully).
 *
 * Prisma — объект с нужными методами: живой Postgres увёл бы файл в
 * integration-слой (vitest.config.ts делит слои по тексту конструктора клиента
 * прямо в исходнике теста, поэтому его здесь нет даже в комментарии).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { getQueue, queueAdd } = vi.hoisted(() => {
  // `add` обязан возвращать обещание: боевой код вешает на него `.catch`, и
  // мок, отдающий undefined, падал бы прямо на нём.
  const queueAdd = vi.fn(async () => undefined);
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

const { bestEffort, swallowed } = vi.hoisted(() => {
  const swallowed = vi.fn();
  return {
    swallowed,
    bestEffort: vi.fn((label: string) => (err: unknown) => swallowed(label, err)),
  };
});
vi.mock('@/lib/logging', () => ({
  bestEffort,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createResyncBatch } from '@/lib/services/bitrix/resync';

type StoredBatch = {
  id: string;
  companyId: string;
  importedById: string;
  source: string;
  status: string;
  settings: unknown;
  createdAt: Date;
};

/** Строки пакетов «в базе» — из них отвечают groupBy и findFirst. */
let stored: StoredBatch[] = [];
const creates: { data: Record<string, unknown> }[] = [];

/** Настройки, выверенные человеком в прошлый раз, — их и наследует повтор. */
const SETTINGS = {
  from: '2026-01-01',
  to: '2026-09-01',
  openOnly: false,
  withFiles: true,
  defaultManagerId: 'm-1',
  fileKeys: [],
  tables: { stageMap: { '0:NEW': 'default:new' } },
  // Картина ПРОШЛОЙ недели: именно она не должна уехать в новый пакет.
  stagesFound: [{ entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая' }],
  usersFound: [{ bitrixId: '1', name: 'Иван' }],
  rows: [{ entity: 'deal', reason: 'нет стадии' }],
};

function batch(over: Partial<StoredBatch> = {}): StoredBatch {
  return {
    id: 'b-1',
    companyId: 'c-1',
    importedById: 'u-1',
    source: 'rest',
    status: 'applied',
    settings: SETTINGS,
    createdAt: new Date('2026-09-01T03:00:00Z'),
    ...over,
  };
}

const groupBy = vi.fn(async (args: any) => {
  const statuses: string[] = args.where.status.in;
  const newest = new Map<string, Date>();
  for (const row of stored) {
    if (!statuses.includes(row.status)) continue;
    const prev = newest.get(row.companyId);
    if (!prev || row.createdAt > prev) newest.set(row.companyId, row.createdAt);
  }
  return [...newest].map(([companyId, createdAt]) => ({ companyId, _max: { createdAt } }));
});

const findFirst = vi.fn(async (args: any) => {
  const statuses: string[] = args.where.status.in;
  let matched = stored.filter(
    (row) => row.companyId === args.where.companyId && statuses.includes(row.status)
  );
  // Сортировка ЧЕСТНАЯ: без `orderBy` сервис получил бы первую попавшуюся
  // строку, и тест «берётся самый свежий пакет» упал бы — как и должен.
  for (const rule of [...(args.orderBy ?? [])].reverse()) {
    const [field, direction] = Object.entries(rule)[0] as [keyof StoredBatch, string];
    matched = [...matched].sort((a, b) =>
      a[field]! < b[field]! ? -1 : a[field]! > b[field]! ? 1 : 0
    );
    if (direction === 'desc') matched.reverse();
  }
  const first = matched[0];
  if (!first) return null;
  // Отдаём РОВНО запрошенные поля: забытое в `select` поле должно быть видно
  // тесту как `undefined`, а не подмениться настоящей строкой.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(args.select)) out[key] = first[key as keyof StoredBatch];
  return out;
});

const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
  creates.push(args);
  return { id: `new-${creates.length}` };
});

const prisma = {
  bitrixImportBatch: { groupBy, findFirst, create },
} as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  creates.length = 0;
  stored = [batch()];
});

describe('createResyncBatch — что повторять', () => {
  it('применённого переноса не было: повторять нечего, очередь не трогаем', async () => {
    stored = [];

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: [], skipped: 0 });

    expect(create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('пакет в «не удалось» не считается применённым: повторять его нельзя', async () => {
    // Настройки провалившегося пакета не выверены человеком — повтор по ним
    // молча гонял бы перенос с заведомо плохими таблицами сопоставления.
    stored = [batch({ status: 'failed' })];

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: [], skipped: 0 });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['companyId'],
        where: { status: { in: ['applied', 'rollback_partial'] } },
      })
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('есть применённый пакет: заводится повтор с настройками прошлого, но без его строк', async () => {
    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: ['new-1'], skipped: 0 });

    expect(creates).toHaveLength(1);
    expect(creates[0]!.data).toEqual({
      companyId: 'c-1',
      importedById: 'u-1',
      source: 'rest',
      mode: 'resync',
      status: 'preview_pending',
      counts: {},
      settings: {
        from: '2026-01-01',
        to: '2026-09-01',
        openOnly: false,
        withFiles: true,
        defaultManagerId: 'm-1',
        fileKeys: [],
        tables: { stageMap: { '0:NEW': 'default:new' } },
        // Пусто, а не «как на прошлой неделе»: унаследованная картина врала бы
        // в отчёте повтора, будто эти сделки нашлись сейчас.
        rows: [],
        stagesFound: [],
        usersFound: [],
      },
    });
  });

  it('повтор идёт через предпросмотр: задача ставится в очередь миграции на новый пакет', async () => {
    await createResyncBatch(prisma);

    expect(getQueue).toHaveBeenCalledWith('bitrix.import');
    // Именно `preview`, а не `apply`: за неделю на портале могла завестись
    // новая стадия, и записывать такие сделки «куда-нибудь» нельзя.
    expect(queueAdd).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledWith('preview', { batchId: 'new-1' });
  });

  it('источником годится и частично откаченный пакет', async () => {
    stored = [
      batch({ status: 'rollback_partial', settings: { ...SETTINGS, defaultManagerId: 'm-9' } }),
    ];

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: ['new-1'], skipped: 0 });
    expect(creates[0]!.data.settings).toMatchObject({
      defaultManagerId: 'm-9',
      rows: [],
      stagesFound: [],
      usersFound: [],
    });
  });

  it('берётся самый свежий пакет компании, а не первый попавшийся', async () => {
    // Старый лежит ПЕРВЫМ: если бы сервис не просил сортировку, повтор унёс бы
    // настройки полугодовой давности — с менеджером, который уже уволился.
    stored = [
      batch({
        id: 'старый',
        createdAt: new Date('2026-03-01T03:00:00Z'),
        settings: { ...SETTINGS, defaultManagerId: 'm-уволенный' },
      }),
      batch({
        id: 'свежий',
        createdAt: new Date('2026-09-08T03:00:00Z'),
        settings: { ...SETTINGS, defaultManagerId: 'm-действующий' },
      }),
    ];

    await createResyncBatch(prisma);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data.settings).toMatchObject({ defaultManagerId: 'm-действующий' });
  });

  it('две компании — два повтора, по одному на каждую', async () => {
    stored = [
      batch({ id: 'b-1', companyId: 'c-1', importedById: 'u-1' }),
      batch({ id: 'b-2', companyId: 'c-2', importedById: 'u-2', source: 'file' }),
    ];

    await expect(createResyncBatch(prisma)).resolves.toEqual({
      batchIds: ['new-1', 'new-2'],
      skipped: 0,
    });

    expect(creates.map((c) => [c.data.companyId, c.data.importedById, c.data.source])).toEqual([
      ['c-1', 'u-1', 'rest'],
      ['c-2', 'u-2', 'file'],
    ]);
    expect(queueAdd.mock.calls).toEqual([
      ['preview', { batchId: 'new-1' }],
      ['preview', { batchId: 'new-2' }],
    ]);
  });
});

describe('createResyncBatch — краевые пути', () => {
  it('у прошлого пакета вместо настроек null: повтор заводится с пустыми', async () => {
    // Пакет мог быть заведён до появления поля — пустые настройки не повод
    // ронять еженедельную задачу целиком.
    stored = [batch({ settings: null })];

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: ['new-1'], skipped: 0 });
    expect(creates[0]!.data.settings).toEqual({ rows: [], stagesFound: [], usersFound: [] });
  });

  it('пакет исчез между двумя запросами: компания пропущена, соседняя перенесена', async () => {
    // Список компаний и чтение их пакетов — ДВА запроса. Между ними строку
    // могли удалить (уборка кабинета, ручная правка базы). Настройки брать
    // неоткуда: компания считается пропущенной, а повтор соседней идёт дальше.
    stored = [batch({ id: 'b-1', companyId: 'c-1' }), batch({ id: 'b-2', companyId: 'c-2' })];
    findFirst.mockImplementationOnce(async () => null);

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: ['new-1'], skipped: 1 });

    expect(creates).toHaveLength(1);
    expect(creates[0]!.data.companyId).toBe('c-2');
  });

  it('очередь недоступна: пакет уже заведён, исключение наружу не летит', async () => {
    queueAdd.mockRejectedValueOnce(new Error('redis не отвечает'));

    await expect(createResyncBatch(prisma)).resolves.toEqual({ batchIds: ['new-1'], skipped: 0 });

    expect(creates).toHaveLength(1);
    expect(swallowed).toHaveBeenCalledWith(
      '[bitrix/resync] задача предпросмотра не поставлена',
      expect.any(Error)
    );
  });
});
