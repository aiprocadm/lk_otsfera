import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

/**
 * Хранилище и очередь нужны только писателю файлов: он единственный ходит в
 * сеть (скачать вложение, положить в S3, поставить антивирус). Здесь это моки —
 * ни Redis, ни S3 к обходу конвейера отношения не имеют.
 */
const { upload, getObjectStorage } = vi.hoisted(() => {
  const upload = vi.fn(async () => undefined);
  return { upload, getObjectStorage: vi.fn(() => ({ upload })) };
});
vi.mock('@/lib/storage', () => ({ getObjectStorage }));

const { queueAdd, getQueue } = vi.hoisted(() => {
  const queueAdd = vi.fn(async () => ({}));
  return { queueAdd, getQueue: vi.fn(() => ({ add: queueAdd })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

import { FakeBitrixSource } from '@/lib/services/bitrix/adapter-fake';
import { unmappedStages } from '@/lib/services/bitrix/mapping/stages';
import {
  BIG_BATCH,
  ROW_CAP,
  runPipeline,
  type PipelineArgs,
  type PipelineProgress,
  type PipelineResult,
} from '@/lib/services/bitrix/pipeline';
import type {
  BitrixComment,
  BitrixCompany,
  BitrixContact,
  BitrixDeal,
  BitrixFile,
  BitrixLead,
  BitrixSource,
  BitrixStage,
  BitrixTask,
  BitrixUser,
} from '@/lib/services/bitrix/source';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Конвейер пакета (`У-193`, `У-194`, спека §3.2): один и тот же обход на
 * предпросмотр и на применение.
 *
 * Главное, что здесь проверяется, — предпросмотр НЕ врёт: сводка совпадает с
 * фикстурой портала, организация, которую только предстоит создать, всё равно
 * видна сделке (реестр `planned:*`), несопоставленная стадия превращает сделку
 * в конфликт и запрещает применение, а большой пакет получает предупреждение.
 *
 * Prisma — объект с нужными методами (живой Postgres увёл бы файл в
 * integration-слой); фальшивые выборки честно фильтруют по `where`, чтобы
 * «нашли» и «не нашли» не зависели от порядка вызовов.
 */

// --- фальшивая база ----------------------------------------------------------

type OrgRow = {
  id: string;
  companyId: string | null;
  name: string;
  inn: string | null;
  kpp: string | null;
  bitrixId: string | null;
  nameKey: string | null;
};

type Seed = {
  companyUsers?: { id: string; email: string; name: string }[];
  staffChannels?: { email: string | null; whatsappPhone: string | null }[];
  dealStages?: Record<string, unknown>[];
  funnelStages?: Record<string, unknown>[];
  taskColumns?: Record<string, unknown>[];
  closedStatus?: { id: string } | null;
  organizations?: OrgRow[];
  contacts?: Record<string, unknown>[];
  contactChannels?: Record<string, unknown>[];
  leads?: Record<string, unknown>[];
  deals?: Record<string, unknown>[];
  tasks?: Record<string, unknown>[];
  documents?: { bitrixId: string }[];
  orders?: Record<string, unknown>[];
  /** Строки журнала: по ним видно, что уже переносили (заметки, снимки полей). */
  journal?: Record<string, unknown>[];
};

const listOf = (args: any, field: string): string[] => args?.where?.[field]?.in ?? [];

/** Выборка «поле в списке» — как у настоящей базы, а не «вернуть всё подряд». */
const byIn =
  (rows: Record<string, unknown>[], field: string) =>
  async (args: any): Promise<Record<string, unknown>[]> =>
    rows.filter((r) => listOf(args, field).includes(r[field] as string));

/** Организации ищутся тремя способами сразу — повторяем разбор `OR`. */
const matchOrganizations = (rows: OrgRow[], args: any): OrgRow[] =>
  rows.filter((row) =>
    (args.where.OR as any[]).some((cond) => {
      if (cond.bitrixId) return cond.bitrixId.in.includes(row.bitrixId);
      if (cond.inn) return cond.inn.in.includes(row.inn);
      return cond.companyId === row.companyId && cond.nameKey.in.includes(row.nameKey);
    })
  );

/**
 * Писатели режима `live`: каждый метод возвращает строку с настоящим
 * идентификатором. По нему и видно главное — реестр связей берёт `organization-1`
 * из ответа базы, а не метку «будет создано» (`planned:*`).
 */
function makeTx() {
  const created = (entity: string) => vi.fn(async () => ({ id: `${entity}-1` }));
  const touched = vi.fn(async () => ({ count: 1 }));
  return {
    organization: { create: created('organization'), update: vi.fn(async () => ({})) },
    organizationNote: { create: created('note') },
    organizationManager: { create: created('org-manager') },
    contact: { create: created('contact'), update: vi.fn(async () => ({})) },
    contactChannel: { createMany: vi.fn(async () => ({ count: 1 })) },
    lead: {
      create: created('lead'),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    deal: {
      create: created('deal'),
      update: vi.fn(async () => ({})),
      updateMany: touched,
      count: vi.fn(async () => 1),
    },
    dealNote: { create: created('note') },
    task: { create: created('task'), update: vi.fn(async () => ({})) },
    order: { create: created('order') },
    orderStatusChange: { create: created('status-change') },
    document: { create: created('document') },
    bitrixImportWrite: { create: created('journal') },
  };
}

/** Строки журнала фильтруются как в базе: иначе «уже переносили» сработает на всём. */
const matchJournal = (rows: Record<string, unknown>[], args: any): Record<string, unknown>[] =>
  rows.filter((row) => {
    const where = args?.where ?? {};
    if (where.entity !== undefined && row.entity !== where.entity) return false;
    if (where.entityId?.in && !where.entityId.in.includes(row.entityId as string)) return false;
    if (where.bitrixId?.in && !where.bitrixId.in.includes(row.bitrixId as string)) return false;
    return true;
  });

function makePrisma(seed: Seed = {}) {
  const tx = makeTx();
  const calls = {
    transaction: vi.fn(async (cb: (client: ReturnType<typeof makeTx>) => Promise<unknown>) =>
      cb(tx)
    ),
    user: vi.fn(async (args: any) => {
      if (args.where.OR) {
        const wanted: string[] = args.where.OR[0].email.in;
        return (seed.staffChannels ?? []).filter(
          (u) =>
            (u.email !== null && wanted.includes(u.email)) ||
            (u.whatsappPhone !== null && wanted.includes(u.whatsappPhone))
        );
      }
      return seed.companyUsers ?? [];
    }),
    dealStage: vi.fn(async () => seed.dealStages ?? []),
    funnelStage: vi.fn(async () => seed.funnelStages ?? []),
    taskColumn: vi.fn(async () => seed.taskColumns ?? []),
    orderStatus: vi.fn(async () => seed.closedStatus ?? null),
    organization: vi.fn(async (args: any) => matchOrganizations(seed.organizations ?? [], args)),
    contact: vi.fn(byIn(seed.contacts ?? [], 'bitrixId')),
    contactChannel: vi.fn(byIn(seed.contactChannels ?? [], 'normalizedValue')),
    lead: vi.fn(byIn(seed.leads ?? [], 'bitrixId')),
    deal: vi.fn(byIn(seed.deals ?? [], 'bitrixId')),
    task: vi.fn(byIn(seed.tasks ?? [], 'bitrixId')),
    document: vi.fn(byIn(seed.documents ?? [], 'bitrixId')),
    order: vi.fn(async (args: any) =>
      (seed.orders ?? []).filter((o) =>
        listOf(args, 'organizationId').includes(o.organizationId as string)
      )
    ),
    journal: vi.fn(async (args: any) => matchJournal(seed.journal ?? [], args)),
  };
  const prisma = {
    $transaction: calls.transaction,
    user: { findMany: calls.user },
    dealStage: { findMany: calls.dealStage },
    funnelStage: { findMany: calls.funnelStage },
    taskColumn: { findMany: calls.taskColumn },
    orderStatusDefinition: { findFirst: calls.orderStatus },
    organization: { findMany: calls.organization },
    contact: { findMany: calls.contact },
    contactChannel: { findMany: calls.contactChannel },
    lead: { findMany: calls.lead },
    deal: { findMany: calls.deal },
    task: { findMany: calls.task },
    document: { findMany: calls.document },
    order: { findMany: calls.order },
    // Журнал: сухой прогон смотрит, какие заметки уже переносили.
    bitrixImportWrite: { findMany: calls.journal },
  } as unknown as PrismaClient;
  return { prisma, calls, tx };
}

// --- источник --------------------------------------------------------------

type SourceParts = {
  users?: BitrixUser[];
  stages?: BitrixStage[];
  companies?: BitrixCompany[];
  contacts?: BitrixContact[];
  leads?: BitrixLead[];
  deals?: BitrixDeal[];
  tasks?: BitrixTask[];
  comments?: BitrixComment[];
  files?: BitrixFile[];
};

function makeSource(parts: SourceParts = {}, overrides: Partial<BitrixSource> = {}): BitrixSource {
  const stream = <T>(items: readonly T[]) =>
    async function* (): AsyncIterable<T> {
      yield* items;
    };
  return {
    check: async () => ({ ok: true, portal: 'test.bitrix24.ru', user: 'тест' }),
    users: stream(parts.users ?? []),
    stages: async () => parts.stages ?? [],
    companies: stream(parts.companies ?? []),
    contacts: stream(parts.contacts ?? []),
    leads: stream(parts.leads ?? []),
    deals: stream(parts.deals ?? []),
    tasks: stream(parts.tasks ?? []),
    comments: async function* (entity, ids) {
      const wanted = new Set(ids);
      for (const c of parts.comments ?? []) {
        if (c.entity === entity && wanted.has(c.entityId) && c.text.trim()) yield c;
      }
    },
    files: async function* (entity, ids) {
      const wanted = new Set(ids);
      for (const f of parts.files ?? []) if (f.entity === entity && wanted.has(f.entityId)) yield f;
    },
    // Настоящая «шапка» PDF: короче восьми байт проверка магических байтов
    // отвергает файл как «слишком короткий», и до хранилища он не доходит.
    download: async () => Buffer.from('%PDF-1.4\n1 0 obj\n'),
    ...overrides,
  };
}

const company = (over: Partial<BitrixCompany> & { id: string }): BitrixCompany => ({
  title: `Компания ${over.id}`,
  inn: null,
  kpp: null,
  assignedById: null,
  createdAt: null,
  comments: null,
  ...over,
});

const contact = (over: Partial<BitrixContact> & { id: string }): BitrixContact => ({
  name: 'Имя',
  lastName: 'Фамилия',
  post: null,
  companyId: null,
  phones: [],
  emails: [],
  assignedById: null,
  createdAt: null,
  ...over,
});

const lead = (over: Partial<BitrixLead> & { id: string }): BitrixLead => ({
  title: `Лид ${over.id}`,
  name: 'Клиент',
  companyTitle: null,
  phones: [],
  emails: [],
  inn: null,
  statusId: 'NEW',
  assignedById: null,
  opportunity: null,
  createdAt: null,
  comments: null,
  ...over,
});

const deal = (over: Partial<BitrixDeal> & { id: string }): BitrixDeal => ({
  title: `Сделка ${over.id}`,
  categoryId: '0',
  stageId: 'NEW',
  opportunity: null,
  companyId: null,
  contactId: null,
  leadId: null,
  assignedById: null,
  createdAt: null,
  closeDate: null,
  closed: false,
  comments: null,
  ...over,
});

const task = (over: Partial<BitrixTask> & { id: string }): BitrixTask => ({
  title: `Задача ${over.id}`,
  description: null,
  status: 2,
  responsibleId: null,
  createdById: null,
  deadline: null,
  createdAt: null,
  closedAt: null,
  crmLinks: [],
  ...over,
});

/** Стадии портала, которые ложатся на дефолтные стадии ЛК без правок человека. */
const PORTAL_STAGES: BitrixStage[] = [
  { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
  { entity: 'deal', categoryId: null, id: 'WON', name: 'Сделка успешна', semantics: 'success' },
  { entity: 'deal', categoryId: null, id: 'LOSE', name: 'Сделка провалена', semantics: 'failure' },
];

// --- запуск ----------------------------------------------------------------

type RunArgs = {
  source?: BitrixSource;
  seed?: Seed;
  batch?: Partial<PipelineArgs['batch']>;
  mode?: PipelineArgs['mode'];
  onProgress?: PipelineArgs['onProgress'];
  /** Настроить писателей до прогона — например, уронить одну запись. */
  arrange?: (tx: ReturnType<typeof makeTx>) => void;
};

async function run(args: RunArgs = {}): Promise<{
  result: PipelineResult;
  calls: ReturnType<typeof makePrisma>['calls'];
  tx: ReturnType<typeof makeTx>;
}> {
  const { prisma, calls, tx } = makePrisma(args.seed);
  args.arrange?.(tx);
  const result = await runPipeline(prisma, {
    batch: {
      id: 'b1',
      companyId: 'c1',
      importedById: 'imp-1',
      filter: {},
      withFiles: true,
      defaultManagerId: 'mgr-1',
      tables: {},
      ...args.batch,
    },
    source: args.source ?? makeSource(),
    mode: args.mode ?? 'shadow',
    ...(args.onProgress ? { onProgress: args.onProgress } : {}),
  });
  return { result, calls, tx };
}

/** Сводка сущности без нулей — так ожидания читаются, а не расшифровываются. */
const nonZero = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== 0));

const reasonsOf = (result: PipelineResult, entity: string): string[] =>
  result.rows.filter((r) => r.entity === entity).map((r) => `${r.bitrixId}: ${r.reason ?? ''}`);

// --- тесты -----------------------------------------------------------------

describe('runPipeline — режим', () => {
  it('сухой прогон не открывает ни одной транзакции — писать ему нечем', async () => {
    const { result, calls, tx } = await run({ source: new FakeBitrixSource() });

    expect(result.counts.total).toBeGreaterThan(0);
    // Писатели у мока есть и готовы принять вызов: если бы сухой прогон полез
    // писать, счётчики бы это показали, а не тест «молча прошёл».
    expect(calls.transaction).not.toHaveBeenCalled();
    expect(tx.organization.create).not.toHaveBeenCalled();
    expect(tx.contact.create).not.toHaveBeenCalled();
    expect(tx.deal.create).not.toHaveBeenCalled();
    expect(tx.bitrixImportWrite.create).not.toHaveBeenCalled();
    // Хранилище и антивирус — тоже запись: файлы сухой прогон только считает.
    expect(upload).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('runPipeline — сухой прогон на фикстуре портала', () => {
  /** Сопоставление, которого фикстуре не хватает: два названия стадий и статус лида. */
  const FULL_TABLES = {
    stageMap: { '0:PREPARATION': 'default:negotiation', '0:EXECUTING': 'default:proposal' },
    leadStageMap: { NEW: 'default:new' },
  };

  it('сводка совпадает с фикстурой, пакет готов к применению', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
    });

    expect(nonZero(result.counts.organization)).toEqual({ create: 5 });
    expect(nonZero(result.counts.contact)).toEqual({ create: 8 });
    expect(nonZero(result.counts.lead)).toEqual({ create: 6 });
    expect(nonZero(result.counts.deal)).toEqual({ create: 6 });
    expect(nonZero(result.counts.task)).toEqual({ create: 4 });
    expect(nonZero(result.counts.file)).toEqual({ create: 3 });
    // Комментарий контакта без организации деть некуда — он честно пропущен.
    expect(nonZero(result.counts.note)).toEqual({ create: 8, skip: 1 });
    // Две выигранные сделки просят заказ.
    expect(nonZero(result.counts.order)).toEqual({ create: 2 });

    // Итог — сумма обработанных записей, а не сумма «создать».
    const processed = [
      result.counts.organization,
      result.counts.contact,
      result.counts.lead,
      result.counts.deal,
      result.counts.note,
      result.counts.task,
      result.counts.file,
      result.counts.order,
    ].reduce((sum, c) => sum + c.create + c.update + c.skip + c.conflict, 0);
    expect(result.counts.total).toBe(processed);
    expect(result.counts.total).toBe(43);

    expect(result.ready).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.counts.warnings).toEqual([]);
    // В строках предпросмотра только то, что требует внимания: общий телефон
    // двух контактов фикстуры и комментарий контакта без организации.
    expect(result.rows).toEqual([
      {
        entity: 'contact',
        bitrixId: '204',
        title: 'Глеб Кузнецов',
        action: 'conflict',
        reason: 'канал не перенесён: +7 812 777 88 99 — уже у контакта «Вера Смирнова»',
      },
      {
        entity: 'note',
        bitrixId: '609',
        title: 'Комментарий контакта без компании',
        action: 'skip',
        reason: 'нет организации',
      },
    ]);
  });

  it('стадии и пользователи портала отдаются экрану вместе с предложенным сопоставлением', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
    });

    expect(result.stagesFound).toHaveLength(9);
    expect(result.usersFound).toEqual([
      {
        bitrixId: '1',
        name: 'Иван Менеджеров',
        email: 'manager@demo.local',
        userId: null,
        matchedBy: 'none',
      },
      {
        bitrixId: '2',
        name: 'Пётр Петров',
        email: 'petrova@bitrix-demo.local',
        userId: null,
        matchedBy: 'none',
      },
      { bitrixId: '3', name: 'Уволенный Сотрудник', email: null, userId: null, matchedBy: 'none' },
    ]);
    // Догадка по семантике и по названию + решение человека из сохранённой таблицы.
    expect(result.tables.stageMap).toEqual({
      '0:NEW': 'default:new',
      '0:PREPARATION': 'default:negotiation',
      '0:EXECUTING': 'default:proposal',
      '0:WON': 'default:won',
      '0:LOSE': 'default:lost',
    });
    expect(result.tables.leadStageMap).toEqual({
      NEW: 'default:new',
      IN_PROCESS: 'default:in_review',
      CONVERTED: 'default:promoted_to_deal',
      JUNK: 'default:rejected',
    });
    expect(result.tables.taskColumnMap).toEqual({
      '2': 'default:todo',
      '3': 'default:in_progress',
      '4': 'default:review',
      '5': 'default:done',
      '6': 'default:todo',
    });
    expect(result.tables.userMap).toEqual({});
  });

  it('организация, которую только предстоит создать, видна сделке и её заказу', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
    });

    // Сделка 401 ссылается на компанию 101, которой в ЛК ещё нет: реестр
    // `planned:*` держит связь, иначе заказ получил бы «нет организации».
    expect(reasonsOf(result, 'order')).toEqual([]);
    expect(nonZero(result.counts.order)).toEqual({ create: 2 });
    expect(reasonsOf(result, 'deal')).toEqual([]);
  });

  it('сотрудник ЛК с той же почтой найден — таблица пользователей заполнена', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
      seed: { companyUsers: [{ id: 'u-1', email: 'Manager@Demo.local', name: 'Иван' }] },
    });

    expect(result.tables.userMap).toEqual({ '1': 'u-1' });
    expect(result.usersFound[0]).toMatchObject({ userId: 'u-1', matchedBy: 'email' });
    expect(result.usersFound[1]).toMatchObject({ userId: null, matchedBy: 'none' });
  });

  it('без сопоставления двух стадий сделки и статуса лида пакет применить нельзя', async () => {
    const { result } = await run({ source: new FakeBitrixSource() });

    expect(result.ready).toBe(false);
    expect(
      unmappedStages(result.stagesFound, result.tables.stageMap, result.tables.leadStageMap)
    ).toEqual(['Сделки: Подготовка документов', 'Сделки: В работе', 'Лиды: Не обработан']);
    expect(nonZero(result.counts.deal)).toEqual({ create: 4, conflict: 2 });
    expect(nonZero(result.counts.lead)).toEqual({ create: 4, conflict: 2 });
    expect(reasonsOf(result, 'deal')).toEqual([
      '402: стадия не сопоставлена: стадия «EXECUTING»',
      '406: стадия не сопоставлена: стадия «PREPARATION»',
    ]);
    expect(reasonsOf(result, 'lead')).toEqual([
      '303: стадия не сопоставлена: статус «NEW»',
      '306: стадия не сопоставлена: статус «NEW»',
    ]);
  });

  it('несопоставленная сделка тянет за собой свои комментарии и файлы', async () => {
    const { result } = await run({ source: new FakeBitrixSource() });

    // Сделки 402 нет в реестре: её комментарий и её файл источник уже не отдаёт.
    expect(nonZero(result.counts.note)).toEqual({ create: 7, skip: 1 });
    expect(nonZero(result.counts.file)).toEqual({ create: 2 });
  });

  it('лид без ответственного и без менеджера по умолчанию — конфликт, а не невидимка', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES, defaultManagerId: null },
    });

    expect(nonZero(result.counts.lead)).toEqual({ conflict: 6 });
    expect(reasonsOf(result, 'lead')[0]).toBe(
      '301: некому назначить ответственного: лид без ответственного не виден никому — выберите менеджера по умолчанию'
    );
  });
});

describe('runPipeline — стадии и связность', () => {
  const UNKNOWN_STAGE: BitrixStage = {
    entity: 'deal',
    categoryId: null,
    id: 'APPROVAL',
    name: 'Согласование у юриста',
    semantics: 'process',
  };

  it('стадия портала без пары в ЛК: сделки — в конфликты, применять нельзя', async () => {
    const source = makeSource({
      stages: [...PORTAL_STAGES, UNKNOWN_STAGE],
      deals: [
        deal({ id: '430', title: '', stageId: 'APPROVAL' }),
        deal({ id: '431', stageId: 'APPROVAL' }),
        deal({ id: '432', stageId: 'NEW' }),
      ],
    });

    const { result } = await run({ source });

    expect(result.ready).toBe(false);
    expect(
      unmappedStages(result.stagesFound, result.tables.stageMap, result.tables.leadStageMap)
    ).toEqual(['Сделки: Согласование у юриста']);
    expect(result.tables.stageMap['0:APPROVAL']).toBeNull();
    expect(nonZero(result.counts.deal)).toEqual({ create: 1, conflict: 2 });
    expect(reasonsOf(result, 'deal')).toEqual([
      '430: стадия не сопоставлена: стадия «APPROVAL»',
      '431: стадия не сопоставлена: стадия «APPROVAL»',
    ]);
    // Сделка без названия показана своим идентификатором, а не пустой строкой.
    expect(result.rows[0].title).toBe('430');
  });

  it('сохранённое человеком сопоставление сильнее догадки и делает пакет готовым', async () => {
    const source = makeSource({ stages: [...PORTAL_STAGES, UNKNOWN_STAGE] });

    const { result } = await run({
      source,
      batch: { tables: { stageMap: { '0:APPROVAL': 'default:negotiation' } } },
    });

    expect(result.tables.stageMap['0:APPROVAL']).toBe('default:negotiation');
    expect(result.ready).toBe(true);
  });

  it('своя стадия компании подхватывается по названию портала', async () => {
    const source = makeSource({
      stages: [UNKNOWN_STAGE],
      deals: [deal({ id: '433', stageId: 'APPROVAL' })],
    });

    const { result } = await run({
      source,
      seed: {
        dealStages: [
          {
            id: 'ds-1',
            name: 'Согласование у юриста',
            position: 0,
            statusAnchor: 'open',
            isTerminal: false,
            color: null,
          },
        ],
      },
    });

    expect(result.tables.stageMap['0:APPROVAL']).toBe('ds-1');
    expect(result.ready).toBe(true);
    expect(nonZero(result.counts.deal)).toEqual({ create: 1 });
  });
});

describe('runPipeline — заказы из выигранных сделок', () => {
  /** Компания портала, которой в ЛК уже соответствует организация (по названию). */
  const EXISTING_ORG: OrgRow = {
    id: 'org-1',
    companyId: 'c1',
    name: 'Компания 101',
    inn: null,
    kpp: null,
    bitrixId: null,
    nameKey: 'КОМПАНИЯ 101',
  };
  const SECOND_ORG: OrgRow = {
    ...EXISTING_ORG,
    id: 'org-2',
    name: 'Компания 102',
    nameKey: 'КОМПАНИЯ 102',
  };

  const order = (over: Record<string, unknown>): Record<string, unknown> => ({
    organizationId: 'org-1',
    externalId: null,
    orderNumber: null,
    totalAmount: '0',
    closedAt: null,
    completedAt: null,
    ...over,
  });

  it('выигранная сделка без организации — пропуск с причиной «нет организации»', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      deals: [
        deal({ id: '440', stageId: 'WON', companyId: null }),
        // Ссылка на компанию, которой в выгрузке не было: организации нет тоже.
        deal({ id: '441', stageId: 'WON', companyId: '999' }),
      ],
    });

    const { result, calls } = await run({ source });

    expect(nonZero(result.counts.order)).toEqual({ skip: 2 });
    expect(reasonsOf(result, 'order')).toEqual(['440: нет организации', '441: нет организации']);
    // Настоящих организаций нет — заказы не спрашиваем вовсе.
    expect(calls.order).not.toHaveBeenCalled();
  });

  it('заказ 1С той же организации найден — сделка привязывается, а не плодит второй заказ', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' }), company({ id: '102' })],
      deals: [
        deal({
          id: '410',
          title: 'Охрана труда',
          stageId: 'WON',
          companyId: '101',
          opportunity: '120000',
          closeDate: new Date('2025-12-20T00:00:00Z'),
        }),
        deal({ id: '411', title: '', stageId: 'WON', companyId: '101', opportunity: '45000' }),
        deal({
          id: '412',
          title: 'Промбезопасность',
          stageId: 'WON',
          companyId: '101',
          opportunity: '999',
        }),
        deal({ id: '413', title: '', stageId: 'WON', companyId: '101' }),
        // У второй организации заказов нет вовсе — заводим заказ-историю.
        deal({ id: '414', stageId: 'WON', companyId: '102', opportunity: '7000' }),
      ],
    });

    const { result, calls } = await run({
      source,
      seed: {
        organizations: [EXISTING_ORG, SECOND_ORG],
        closedStatus: { id: 'st-closed' },
        orders: [
          order({
            id: 'ord-1',
            externalId: '1c-1',
            orderNumber: '№1',
            totalAmount: '120000',
            closedAt: new Date('2025-12-25T00:00:00Z'),
          }),
          order({ id: 'ord-2', externalId: '1c-2', totalAmount: '45000' }),
        ],
      },
    });

    // Обе организации уже есть в ЛК — их дописали `bitrixId`, а не создали заново.
    expect(nonZero(result.counts.organization)).toEqual({ update: 2 });
    // Два заказа найдены в 1С (`update`), два заведены как история (`create`).
    expect(nonZero(result.counts.order)).toEqual({ update: 2, create: 3 });
    expect(calls.order).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { companyId: 'c1', organizationId: { in: ['org-1', 'org-2'] } },
      })
    );
    // Строка привязки показывается в обход общего правила «только пропуски и
    // конфликты»: человек должен видеть, К КАКОМУ заказу прилипнет сделка, а не
    // только цифру в колонке «обновим».
    expect(reasonsOf(result, 'order')).toEqual([
      '410: заказ найден в 1С: №1',
      '411: заказ найден в 1С: 1c-2',
    ]);
  });

  it('заказ этой же сделки уже заведён — пропуск «уже связано», второго не будет', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      deals: [deal({ id: '415', stageId: 'WON', companyId: '101', opportunity: '1000' })],
    });

    const { result } = await run({
      source,
      seed: {
        organizations: [EXISTING_ORG],
        orders: [order({ id: 'ord-9', externalId: 'bitrix:deal:415', totalAmount: '1000' })],
      },
    });

    expect(nonZero(result.counts.order)).toEqual({ skip: 1 });
    expect(reasonsOf(result, 'order')).toEqual(['415: уже связано']);
  });

  it('один заказ 1С не достаётся двум сделкам — второй заводится свой', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      deals: [
        deal({ id: '416', stageId: 'WON', companyId: '101', opportunity: '50000' }),
        deal({ id: '417', stageId: 'WON', companyId: '101', opportunity: '50000' }),
      ],
    });

    const { result } = await run({
      source,
      seed: {
        organizations: [EXISTING_ORG],
        orders: [
          order({ id: 'ord-1', externalId: '1c-1', orderNumber: '№1', totalAmount: '50000' }),
        ],
      },
    });

    // Заказ один: первая сделка его забирает, второй остаётся завести свой.
    // Иначе сводка обещала бы две привязки к одной строке 1С, а применение
    // оставило бы вторую сделку ни с чем.
    expect(nonZero(result.counts.order)).toEqual({ update: 1, create: 1 });
    expect(reasonsOf(result, 'order')).toEqual(['416: заказ найден в 1С: №1']);
  });

  it('выигранная сделка просит заказ и тогда, когда она уже заведена в ЛК', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      deals: [
        deal({
          id: '420',
          title: 'Новое название',
          stageId: 'WON',
          companyId: '101',
          opportunity: '1000',
        }),
        deal({ id: '421', title: 'Без изменений', stageId: 'WON' }),
      ],
    });

    const { result } = await run({
      source,
      seed: {
        organizations: [EXISTING_ORG],
        deals: [
          {
            id: 'd-1',
            title: 'Старое название',
            status: 'won',
            stageId: null,
            orderId: null,
            organizationId: 'org-1',
            bitrixId: '420',
          },
          {
            id: 'd-2',
            title: 'Без изменений',
            status: 'won',
            stageId: null,
            orderId: null,
            organizationId: null,
            bitrixId: '421',
          },
        ],
      },
    });

    expect(nonZero(result.counts.deal)).toEqual({ update: 1, skip: 1 });
    expect(reasonsOf(result, 'deal')).toEqual(['421: нечего менять']);
    // «Выиграна» — свойство сопоставленной стадии, а не патча записи: у
    // обновления патч частичный, и раньше заказ по такой сделке не появлялся
    // никогда. Теперь 420 просит заказ, а 421 честно упирается в организацию.
    expect(nonZero(result.counts.order)).toEqual({ create: 1, skip: 1 });
    expect(reasonsOf(result, 'order')).toEqual(['421: нет организации']);
  });
});

describe('runPipeline — заметки из комментариев', () => {
  it('комментарий контакта, чья организация неизвестна, пропускается с именем-заглушкой', async () => {
    const source = makeSource(
      { contacts: [contact({ id: '201' })] },
      {
        // Источник отдал комментарий о контакте, которого не было в выгрузке.
        comments: async function* (entity) {
          if (entity !== 'contact') return;
          yield {
            id: '609',
            entity: 'contact',
            entityId: '999',
            authorId: null,
            text: 'Комментарий о неизвестном',
            createdAt: null,
          };
        },
      }
    );

    const { result } = await run({ source });

    expect(nonZero(result.counts.note)).toEqual({ skip: 1 });
    expect(result.rows).toEqual([
      {
        entity: 'note',
        bitrixId: '609',
        title: 'Комментарий о неизвестном',
        action: 'skip',
        reason: 'нет организации',
      },
    ]);
  });

  it('комментарий сделки, которая не перенеслась, пропускается с причиной про сделку', async () => {
    const source = makeSource(
      { stages: PORTAL_STAGES, deals: [deal({ id: '401' })] },
      {
        // Источник отдал комментарий сделки, которой в реестре нет.
        comments: async function* (entity) {
          if (entity !== 'deal') return;
          yield {
            id: '603',
            entity: 'deal',
            entityId: '999',
            authorId: null,
            text: 'Договор на согласовании у юристов',
            createdAt: null,
          };
        },
      }
    );

    const { result } = await run({ source });

    // Причина названа своим именем: заметке некуда лечь потому, что не
    // перенеслась СДЕЛКА, а не потому, что «нет контакта» — про контакт здесь
    // речи вообще не шло, и человек искал бы поломку не там.
    expect(nonZero(result.counts.note)).toEqual({ skip: 1 });
    expect(reasonsOf(result, 'note')).toEqual(['603: сделка не перенесена']);
  });

  it('без единой сущности в реестре комментарии не спрашиваются вовсе', async () => {
    const comments = vi.fn(async function* () {});
    const source = makeSource({}, { comments: comments as unknown as BitrixSource['comments'] });

    const { result } = await run({ source });

    expect(comments).not.toHaveBeenCalled();
    expect(nonZero(result.counts.note)).toEqual({});
  });
});

describe('runPipeline — файлы', () => {
  const FULL_TABLES = {
    stageMap: { '0:PREPARATION': 'default:negotiation', '0:EXECUTING': 'default:proposal' },
    leadStageMap: { NEW: 'default:new' },
  };

  it('файлы не запрошены — одна строка-пропуск про настройки пакета', async () => {
    const { result, calls } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES, withFiles: false },
    });

    expect(nonZero(result.counts.file)).toEqual({ skip: 1 });
    expect(result.rows).toContainEqual({
      entity: 'file',
      bitrixId: '—',
      title: 'Файлы',
      action: 'skip',
      reason: 'файлы не запрошены в настройках пакета',
    });
    expect(calls.document).not.toHaveBeenCalled();
    // Пропуск — такая же обработанная запись, как остальные: 43 с файлами и 41
    // без них (ушли три файла, пришла одна строка-пропуск). Иначе строка в
    // списке была бы, а в сводке её бы не было — и цифры не сходились.
    expect(result.counts.total).toBe(41);
  });

  it('файл, уже перенесённый прошлым пакетом, пропускается как «уже связано»', async () => {
    const { result, calls } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
      seed: { documents: [{ bitrixId: '701' }] },
    });

    expect(nonZero(result.counts.file)).toEqual({ create: 2, skip: 1 });
    expect(reasonsOf(result, 'file')).toEqual(['701: уже связано']);
    // Известные документы спрашиваются один раз на сущность, а не на файл.
    expect(calls.document).toHaveBeenCalledTimes(2);
  });

  it('файл сделки без организации переносить некуда', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      deals: [deal({ id: '450', companyId: null })],
      files: [
        { id: '710', entity: 'deal', entityId: '450', name: 'кп.pdf', size: 10, downloadUrl: null },
      ],
    });

    const { result } = await run({ source });

    expect(nonZero(result.counts.file)).toEqual({ skip: 1 });
    expect(reasonsOf(result, 'file')).toEqual(['710: нет организации']);
  });

  it('сделок нет — спрашиваем только файлы компаний', async () => {
    const files = vi.fn(async function* (entity: string) {
      if (entity !== 'company') return;
      yield {
        id: '703',
        entity: 'company',
        entityId: '101',
        name: 'реквизиты.pdf',
        size: 1,
        downloadUrl: null,
      };
    });
    const source = makeSource(
      { companies: [company({ id: '101' })] },
      { files: files as unknown as BitrixSource['files'] }
    );

    const { result } = await run({ source });

    expect(files.mock.calls.map((c) => c[0])).toEqual(['company', 'company']);
    expect(nonZero(result.counts.file)).toEqual({ create: 1 });
  });
});

describe('runPipeline — контакты', () => {
  it('канал совпал с контактом без bitrixId — это он: обновление, а не второй контакт', async () => {
    const { result } = await run({
      source: new FakeBitrixSource(),
      seed: {
        contactChannels: [
          {
            type: 'email',
            normalizedValue: 'orlova@vector.local',
            contact: {
              id: 'k-1',
              name: 'Дарья',
              position: null,
              organizationId: null,
              bitrixId: null,
            },
          },
        ],
      },
    });

    expect(nonZero(result.counts.contact)).toEqual({ create: 7, update: 1 });
  });

  it('телефон ищется в каноническом виде — свой контакт находится, а не создаётся заново', async () => {
    const { result, calls } = await run({
      source: new FakeBitrixSource(),
      seed: {
        // В базе телефон хранится канонически — так его пишет `normalizeChannelValue`.
        contactChannels: [
          {
            type: 'phone',
            normalizedValue: '+79211112233',
            contact: {
              id: 'k-1',
              name: 'Анна',
              position: null,
              organizationId: null,
              bitrixId: null,
            },
          },
        ],
      },
    });

    const asked: string[] = calls.contactChannel.mock.calls[0][0].where.normalizedValue.in;
    expect(asked).toContain('+79211112233');
    expect(asked).not.toContain('+7 (921) 111-22-33');
    // «+7 (921) 111-22-33» и «+79211112233» — один телефон: контакт 201 узнан,
    // ему допишут `bitrixId`. Сырым значением он бы не нашёлся, а применение
    // упёрлось бы в уникальный индекс канала.
    expect(nonZero(result.counts.contact)).toEqual({ create: 7, update: 1 });
  });

  it('два контакта пакета с одним телефоном: канал остаётся у первого, о втором сказано', async () => {
    // В фикстуре телефон «+7 812 777 88 99» у контактов 203 и 204. В базе такой
    // канал один на компанию, и без учёта занятых В ПРЕДЕЛАХ пакета применение
    // упёрлось бы в уникальный индекс уже после всех проверок.
    const { result } = await run({ source: new FakeBitrixSource() });

    expect(nonZero(result.counts.contact)).toEqual({ create: 8 });
    expect(reasonsOf(result, 'contact')).toEqual([
      '204: канал не перенесён: +7 812 777 88 99 — уже у контакта «Вера Смирнова»',
    ]);
  });
});

describe('runPipeline — лиды и организации по названию', () => {
  const LEAD_NEW: BitrixStage = {
    entity: 'lead',
    categoryId: null,
    id: 'NEW',
    name: 'Новый лид',
    semantics: 'process',
  };

  it('организация лида ищется по названию одним запросом на страницу', async () => {
    const source = makeSource({
      stages: [LEAD_NEW],
      leads: [
        lead({ id: '310', companyTitle: 'ООО «Дельта»' }),
        // Название из одной орг-формы ключа не даёт — в запрос не попадает.
        lead({ id: '311', companyTitle: 'ООО' }),
      ],
    });

    const { result, calls } = await run({
      source,
      seed: {
        organizations: [
          {
            id: 'org-d',
            companyId: 'c1',
            name: 'ООО «Дельта»',
            inn: null,
            kpp: null,
            bitrixId: null,
            nameKey: 'ДЕЛЬТА',
          },
        ],
      },
    });

    expect(calls.organization).toHaveBeenCalledTimes(1);
    expect(calls.organization.mock.calls[0][0].where).toEqual({
      OR: [{ companyId: 'c1', nameKey: { in: ['ДЕЛЬТА'] } }],
    });
    expect(nonZero(result.counts.lead)).toEqual({ create: 2 });
  });

  it('страница лидов без названий компаний до базы не доходит', async () => {
    const source = makeSource({ stages: [LEAD_NEW], leads: [lead({ id: '312' })] });

    const { result, calls } = await run({ source });

    // Запрос с пустым `OR` не может вернуть ни строки, а на пакете в 50 000
    // лидов без компаний это сотни бессмысленных кругов к базе.
    expect(calls.organization).not.toHaveBeenCalled();
    expect(nonZero(result.counts.lead)).toEqual({ create: 1 });
  });
});

/** Дешёвый источник на много записей: пустые контакты без каналов и имени. */
function contactsSource(count: number): BitrixSource {
  return makeSource(
    {},
    {
      contacts: async function* () {
        for (let i = 1; i <= count; i += 1) yield contact({ id: `c${i}`, name: '', lastName: '' });
      },
    }
  );
}

describe('runPipeline — прогресс', () => {
  it('о ходе сообщают не реже, чем раз в 50 записей, и обязательно в конце', async () => {
    const seen: PipelineProgress[] = [];
    const { result } = await run({
      source: contactsSource(120),
      onProgress: async (p) => {
        seen.push(p);
      },
    });

    expect(seen.map((p) => p.step)).toEqual(['users', 'stages', 'contact', 'contact', 'file']);
    expect(seen.map((p) => p.done)).toEqual([0, 0, 50, 100, 120]);
    expect(
      seen.every((p) => typeof p.updatedAt === 'string' && !Number.isNaN(Date.parse(p.updatedAt)))
    ).toBe(true);

    expect(result.counts.progress).toMatchObject({ step: 'file', done: 120 });
    expect(result.counts.total).toBe(120);

    // Общего числа записей у постраничного чтения нет, поэтому поля `total` в
    // прогрессе не существует: раньше там лежал тот же счётчик, что и в `done`,
    // и шкала «сделано из всего» всегда показывала ровно 100 %.
    expect(seen.every((p) => !('total' in p))).toBe(true);
    expect(result.counts.progress).not.toHaveProperty('total');
  });

  it('без обработчика прогресса конвейер просто работает', async () => {
    const { result } = await run({ source: contactsSource(60) });

    expect(result.counts.total).toBe(60);
    expect(result.counts.progress).toMatchObject({ step: 'file', done: 60 });
  });
});

describe('runPipeline — пределы пакета', () => {
  it('большой пакет получает два предупреждения: про объём и про усечение списка', async () => {
    const { result } = await run({ source: contactsSource(BIG_BATCH + 1) });

    expect(result.counts.total).toBe(BIG_BATCH + 1);
    expect(nonZero(result.counts.contact)).toEqual({ skip: BIG_BATCH + 1 });
    // Пропусков десятки тысяч — в ответ уходят только первые 500.
    expect(result.rows.length).toBeLessThanOrEqual(500);
    expect(result.rows).toHaveLength(ROW_CAP);
    expect(result.rows.every((r) => r.entity === 'contact' && r.action === 'skip')).toBe(true);
    // Усечение названо вслух: молча показать 500 строк из 50 001 — значит
    // соврать списком, человек решит, что остальных записей и не было.
    expect(result.counts.warnings).toHaveLength(2);
    expect(result.counts.warnings[0]).toBe(
      `Показаны первые ${ROW_CAP} строк из ${BIG_BATCH + 1}: остальные того же рода. Столько же строк будет и в отчёте сверки — все записи целиком отчёт перечисляет на листах сущностей.`
    );
    expect(result.counts.warnings[1]).toContain(`В пакете ${BIG_BATCH + 1} записей`);
    expect(result.counts.warnings[1]).toContain('Разбейте перенос по кварталам');
  }, 60_000);

  it('пакет ровно на пороге предупреждения не получает', async () => {
    const { result } = await run({ source: contactsSource(10) });

    expect(result.counts.total).toBeLessThan(BIG_BATCH);
    expect(result.counts.warnings).toEqual([]);
  });
});

describe('runPipeline — пустой источник', () => {
  it('ничего не нашли: сводка по нулям, строк нет, применять нечего и не страшно', async () => {
    const { result, calls } = await run({ source: makeSource() });

    expect(result.counts.total).toBe(0);
    expect(result.rows).toEqual([]);
    expect(result.stagesFound).toEqual([]);
    expect(result.usersFound).toEqual([]);
    expect(result.counts.progress).toMatchObject({ step: 'file', done: 0 });
    // Стадий портала нет — сопоставлять нечего, поэтому «готов».
    expect(result.ready).toBe(true);
    // Ни одной выборки по страницам: пустые страницы до базы не доходят.
    expect(calls.organization).not.toHaveBeenCalled();
    expect(calls.contact).not.toHaveBeenCalled();
    expect(calls.deal).not.toHaveBeenCalled();
    expect(calls.order).not.toHaveBeenCalled();
    expect(calls.document).not.toHaveBeenCalled();
    // Состояние ЛК всё равно читается один раз: стадии, колонки и сотрудники.
    expect(calls.user).toHaveBeenCalledTimes(1);
    expect(calls.dealStage).toHaveBeenCalledTimes(1);
    expect(calls.funnelStage).toHaveBeenCalledTimes(1);
    expect(calls.taskColumn).toHaveBeenCalledTimes(1);
    expect(calls.orderStatus).toHaveBeenCalledTimes(1);
  });
});

describe('runPipeline — задачи', () => {
  it('задача без названия показана идентификатором, связи берутся из реестра', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      contacts: [contact({ id: '201', companyId: '101' })],
      deals: [deal({ id: '401', companyId: '101' })],
      leads: [],
      tasks: [
        task({
          id: '501',
          title: '',
          status: 5,
          closedAt: new Date('2026-01-01T00:00:00Z'),
          crmLinks: [
            { kind: 'company', id: '101' },
            { kind: 'deal', id: '401' },
            { kind: 'contact', id: '201' },
            { kind: 'lead', id: '999' },
          ],
        }),
        task({ id: '502', status: 6 }),
      ],
    });

    const { result, calls } = await run({ source });

    expect(nonZero(result.counts.task)).toEqual({ create: 2 });
    expect(calls.task).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1', bitrixId: { in: ['501', '502'] } } })
    );
  });

  it('задача, которая уже есть в ЛК и не изменилась, пропускается', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      tasks: [task({ id: '503', title: 'Та же' })],
    });

    const { result } = await run({
      source,
      seed: {
        tasks: [{ id: 't-1', title: 'Та же', status: 'todo', columnId: null, bitrixId: '503' }],
      },
    });

    expect(nonZero(result.counts.task)).toEqual({ skip: 1 });
    expect(reasonsOf(result, 'task')).toEqual(['503: нечего менять']);
  });
});

describe('runPipeline — организации по ИНН', () => {
  /** ИНН с верной контрольной суммой — иначе `planOrganization` считает его отсутствующим. */
  const VALID_INN = '7701234507';

  const orgRow = (over: Partial<OrgRow>): OrgRow => ({
    id: 'org-1',
    companyId: 'c1',
    name: 'Альфа Строй Плюс',
    inn: VALID_INN,
    kpp: null,
    bitrixId: null,
    nameKey: 'АЛЬФА СТРОЙ ПЛЮС',
    ...over,
  });

  it('организация найдена по ИНН — дописываем bitrixId, второй строки не заводим', async () => {
    const source = makeSource({
      companies: [company({ id: '101', title: 'ООО «Альфа»', inn: VALID_INN })],
    });

    const { result, calls } = await run({ source, seed: { organizations: [orgRow({})] } });

    expect(calls.organization.mock.calls[0][0].where.OR).toContainEqual({
      inn: { in: [VALID_INN] },
    });
    expect(nonZero(result.counts.organization)).toEqual({ update: 1 });
  });

  it('тот же ИНН у организации другой компании — конфликт, а не запись в чужой контур', async () => {
    const source = makeSource({
      companies: [company({ id: '101', title: 'ООО «Альфа»', inn: VALID_INN })],
    });

    const { result } = await run({
      source,
      seed: { organizations: [orgRow({ id: 'org-alien', companyId: 'c2', name: 'Чужая Альфа' })] },
    });

    expect(nonZero(result.counts.organization)).toEqual({ conflict: 1 });
    expect(reasonsOf(result, 'organization')).toEqual([
      '101: ИНН у организации другой компании: «Чужая Альфа» уже заведена в другой компании',
    ]);
  });

  it('ИНН с пробелом ищется нормализованным — своя организация находится', async () => {
    const source = makeSource({
      companies: [company({ id: '101', title: 'ООО «Альфа»', inn: '77 01234507' })],
    });

    const { result, calls } = await run({ source, seed: { organizations: [orgRow({})] } });

    // В базу уходит канон — в таком виде ИНН и хранится, и сравнивается
    // правилом. Сырым значением своя же организация не нашлась бы, а
    // «создать» упёрлось бы в глобально уникальный индекс `Organization.inn`.
    expect(calls.organization.mock.calls[0][0].where.OR).toContainEqual({
      inn: { in: [VALID_INN] },
    });
    expect(nonZero(result.counts.organization)).toEqual({ update: 1 });
  });

  it('ИНН с битой контрольной суммой в запрос не уходит вовсе', async () => {
    const source = makeSource({
      companies: [company({ id: '101', title: 'ООО «Альфа»', inn: '1234567890' })],
    });

    const { result, calls } = await run({ source, seed: { organizations: [orgRow({})] } });

    // Мусорный номер не нашёл бы ничего, а в карточку лёг бы как настоящий:
    // в запросе условия по ИНН нет, организация заводится как новая.
    const where = calls.organization.mock.calls[0][0].where;
    expect(where.OR.some((c: any) => c.inn)).toBe(false);
    expect(nonZero(result.counts.organization)).toEqual({ create: 1 });
  });

  it('ИНН фикстуры портала настоящие — компания находится по ИНН', async () => {
    const { result, calls } = await run({
      source: new FakeBitrixSource(),
      seed: {
        organizations: [
          {
            id: 'org-alfa',
            companyId: 'c1',
            name: 'Альфа Строй',
            inn: '7701234560',
            kpp: null,
            bitrixId: null,
            nameKey: 'АЛЬФА СТРОЙ',
          },
        ],
      },
    });

    // Все три ИНН фикстуры проходят контрольную сумму ФНС. С «красивым»
    // выдуманным номером сопоставление отбрасывало его как мусор, и сценарий
    // приёмки «компания нашлась по ИНН» не воспроизводился ни разу.
    const asked = calls.organization.mock.calls[0][0].where.OR.find((c: any) => c.inn);
    expect(asked.inn.in).toEqual(['7701234560', '7812345675', '771234567859']);
    // Компания 101 узнана по ИНН: ей дописывают `bitrixId`, дубля нет.
    expect(nonZero(result.counts.organization)).toEqual({ create: 4, update: 1 });
  });
});

describe('runPipeline — задача, привязанная только к контакту', () => {
  it('организация задачи берётся из организации контакта', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      contacts: [contact({ id: '201', companyId: '101' })],
      tasks: [task({ id: '505', crmLinks: [{ kind: 'contact', id: '201' }] })],
    });

    const { result } = await run({ source });

    expect(nonZero(result.counts.task)).toEqual({ create: 1 });
    expect(nonZero(result.counts.contact)).toEqual({ create: 1 });
  });
});

describe('runPipeline — повторный прогон того же пакета', () => {
  it('уже перенесённая организация не выпадает из реестра — её сделка, заметка и файл на месте', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      deals: [deal({ id: '401', stageId: 'WON', companyId: '101', opportunity: '1000' })],
      comments: [
        {
          id: '606',
          entity: 'company',
          entityId: '101',
          authorId: null,
          text: 'Звонить после 14:00',
          createdAt: null,
        },
      ],
      files: [
        {
          id: '703',
          entity: 'company',
          entityId: '101',
          name: 'реквизиты.pdf',
          size: 1,
          downloadUrl: null,
        },
      ],
    });

    const { result } = await run({
      source,
      seed: {
        // Та же организация уже перенесена: менять в ней нечего.
        organizations: [
          {
            id: 'org-1',
            companyId: 'c1',
            name: 'Компания 101',
            inn: null,
            kpp: null,
            bitrixId: '101',
            nameKey: 'КОМПАНИЯ 101',
          },
        ],
      },
    });

    expect(nonZero(result.counts.organization)).toEqual({ skip: 1 });
    // «Нечего менять» — это тоже «запись есть»: план несёт `id`, реестр его
    // помнит, и сделка видит свою организацию. Иначе повторный прогон того же
    // пакета показывал бы «нет организации» там, где связь давно есть.
    expect(reasonsOf(result, 'order')).toEqual([]);
    expect(nonZero(result.counts.order)).toEqual({ create: 1 });
    // Комментарий и файл этой организации конвейер теперь спрашивает и считает.
    expect(nonZero(result.counts.note)).toEqual({ create: 1 });
    expect(nonZero(result.counts.file)).toEqual({ create: 1 });
    // Пять записей: организация, сделка, заказ, заметка и файл.
    expect(result.counts.total).toBe(5);
  });
});

describe('runPipeline — режим записи', () => {
  /** Сопоставление, которого фикстуре не хватает: два названия стадий и статус лида. */
  const FULL_TABLES = {
    stageMap: { '0:PREPARATION': 'default:negotiation', '0:EXECUTING': 'default:proposal' },
    leadStageMap: { NEW: 'default:new' },
  };

  /** Организация фикстуры, которая в ЛК уже есть: по ней видно настоящий id. */
  const KNOWN_ORG: OrgRow = {
    id: 'org-1',
    companyId: 'c1',
    name: 'Компания 101',
    inn: null,
    kpp: null,
    bitrixId: null,
    nameKey: 'КОМПАНИЯ 101',
  };

  it('фикстура портала записывается строка за строкой, и каждая запись — со строкой журнала', async () => {
    const { result, calls, tx } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES },
      mode: 'live',
      seed: { closedStatus: { id: 'st-closed' } },
    });

    // Сводка сухого прогона и число реальных записей обязаны совпадать: если
    // предпросмотр обещает 5 организаций, применение пишет ровно 5.
    expect(tx.organization.create).toHaveBeenCalledTimes(5);
    expect(tx.contact.create).toHaveBeenCalledTimes(8);
    expect(tx.lead.create).toHaveBeenCalledTimes(6);
    expect(tx.deal.create).toHaveBeenCalledTimes(6);
    expect(tx.task.create).toHaveBeenCalledTimes(4);
    expect(nonZero(result.counts.organization)).toEqual({ create: 5 });
    expect(nonZero(result.counts.contact)).toEqual({ create: 8 });

    // Заметки, заказы и вложения тоже записаны — своими писателями. Заметок
    // организаций на две больше, чем комментариев портала: у двух компаний
    // фикстуры нет ИНН, и пометку об этом писатель кладёт заметкой.
    expect(nonZero(result.counts.note)).toEqual({ create: 8, skip: 1 });
    expect(tx.dealNote.create).toHaveBeenCalledTimes(5);
    expect(tx.organizationNote.create).toHaveBeenCalledTimes(3 + 2);
    expect(tx.order.create).toHaveBeenCalledTimes(2);
    expect(tx.document.create).toHaveBeenCalledTimes(3);

    // Журнал — единственный способ откатить перенос, поэтому строка в нём
    // обязана быть у КАЖДОЙ записи: 5 + 8 + 6 + 6 + 8 + 4 + 2 + 3, плюс две
    // пометки «ИНН не указан». Пометка — такая же заметка организации, как и
    // перенесённый комментарий: без строки журнала она пережила бы откат и
    // держала бы организацию как «чужая работа поверх переноса».
    expect(tx.bitrixImportWrite.create).toHaveBeenCalledTimes(44);
    // Транзакций на одну больше: у каждой строки своя короткая транзакция, и
    // одна ушла на заметку, которой некуда лечь — писатель вернул «нечего
    // писать», и строки журнала по ней справедливо нет.
    expect(calls.transaction).toHaveBeenCalledTimes(43);
    expect(result.errors).toEqual([]);

    // Вложения прошли полный путь: хранилище и очередь антивируса.
    expect(upload).toHaveBeenCalledTimes(3);
    expect(getQueue).toHaveBeenCalledWith('docs.scanDocument');
    expect(queueAdd).toHaveBeenCalledTimes(3);
  });

  it('реестр связей берёт настоящие идентификаторы, а не метку «будет создано»', async () => {
    const { tx } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES, withFiles: false },
      mode: 'live',
    });

    const createdOrgId = ((await tx.organization.create.mock.results[0].value) as { id: string })
      .id;
    const dealOrgIds = tx.deal.create.mock.calls.map((c: any) => c[0].data.organizationId);

    // Сделка ссылается на строку, которую только что вернула база. Без этого в
    // `organizationId` уехала бы метка `planned:organization:101`, и связь
    // «сделка → организация» указывала бы в никуда.
    expect(createdOrgId).toBe('organization-1');
    expect(dealOrgIds).toContain(createdOrgId);
    expect(dealOrgIds.some((id: unknown) => String(id).startsWith('planned:'))).toBe(false);
  });

  it('ошибка записи одной строки не роняет прогон: остальные записи идут дальше', async () => {
    const { result, tx } = await run({
      source: new FakeBitrixSource(),
      batch: { tables: FULL_TABLES, withFiles: false },
      mode: 'live',
      arrange: (t) => {
        t.contact.create
          .mockResolvedValueOnce({ id: 'contact-1' })
          .mockRejectedValueOnce(new Error('дубль канала'));
      },
    });

    // Из-за одной кривой записи терять весь перенос нельзя: она уходит в
    // отчёт, а остальные контакты, сделки и задачи пишутся как обычно.
    expect(result.errors).toEqual([
      { bitrixId: '202', entity: 'contact', message: 'дубль канала' },
    ]);
    expect(result.rows).toContainEqual({
      entity: 'contact',
      bitrixId: '202',
      title: 'Борис Петров',
      action: 'conflict',
      reason: 'не записано: дубль канала',
    });
    expect(tx.contact.create).toHaveBeenCalledTimes(8);
    expect(tx.deal.create).toHaveBeenCalledTimes(6);
    expect(tx.task.create).toHaveBeenCalledTimes(4);
  });

  it('поле, правленное человеком, остаётся ему — строка отчёта «оставлено ручное значение»', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      deals: [deal({ id: '460', title: 'Название из Битрикса' })],
    });

    const { result, calls, tx } = await run({
      source,
      mode: 'live',
      batch: { withFiles: false },
      seed: {
        deals: [
          {
            id: 'd-1',
            title: 'Название, поправленное менеджером',
            // Статус и стадия совпадают с планом — расходится только название.
            status: 'open',
            stageId: 'default:new',
            orderId: null,
            organizationId: null,
            wonAt: null,
            lostAt: null,
            bitrixId: '460',
          },
        ],
        // Прошлый прогон записал одно, а в кабинете сейчас другое — значит,
        // название правил человек, и его работа сильнее повторного переноса.
        journal: [
          {
            entity: 'deal',
            entityId: 'd-1',
            bitrixId: '460',
            after: { title: 'Название прошлого прогона' },
          },
        ],
      },
    });

    expect(calls.journal).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity: 'deal', entityId: { in: ['d-1'] } }),
      })
    );
    expect(tx.deal.update).not.toHaveBeenCalled();
    expect(result.rows).toContainEqual({
      entity: 'deal',
      bitrixId: '460',
      title: 'Название из Битрикса',
      action: 'update',
      reason: 'оставлено ручное значение: title',
    });
  });

  it('лид и задача, уже заведённые в ЛК, обновляются одной записью каждый', async () => {
    const source = makeSource({
      stages: [
        { entity: 'lead', categoryId: null, id: 'NEW', name: 'Новый лид', semantics: 'process' },
      ],
      leads: [lead({ id: '320', title: 'Новая тема' })],
      tasks: [task({ id: '510', title: 'Новое название' })],
    });

    const { result, tx } = await run({
      source,
      mode: 'live',
      batch: { withFiles: false },
      seed: {
        leads: [
          {
            id: 'l-1',
            subject: 'Старая тема',
            status: 'new',
            funnelStageId: null,
            bitrixId: '320',
          },
        ],
        tasks: [
          {
            id: 't-1',
            title: 'Старое название',
            status: 'todo',
            columnId: null,
            completedAt: null,
            bitrixId: '510',
          },
        ],
      },
    });

    expect(nonZero(result.counts.lead)).toEqual({ update: 1 });
    expect(nonZero(result.counts.task)).toEqual({ update: 1 });
    expect(tx.lead.update).toHaveBeenCalledWith({
      where: { id: 'l-1' },
      data: { subject: 'Новая тема' },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: 't-1' },
      data: { title: 'Новое название' },
    });
    expect(tx.lead.create).not.toHaveBeenCalled();
    expect(tx.task.create).not.toHaveBeenCalled();
    // Кроме строки «файлы не запрошены» человеку показывать нечего: обновления
    // в списке не показываются, а «оставлено ручное» здесь не сработало.
    expect(result.rows.filter((r) => r.entity !== 'file')).toEqual([]);
  });

  it('выигранные сделки: одна прилипает к заказу 1С, второй заводится свой', async () => {
    const source = makeSource({
      stages: PORTAL_STAGES,
      companies: [company({ id: '101' })],
      // Обе без названия: в строке отчёта такая сделка зовётся идентификатором,
      // а не пустыми кавычками — и в привязке, и в заведённом заказе.
      deals: [
        deal({ id: '470', title: '', stageId: 'WON', companyId: '101', opportunity: '50000' }),
        deal({ id: '471', title: '', stageId: 'WON', companyId: '101', opportunity: '7000' }),
      ],
    });

    const { result, tx } = await run({
      source,
      mode: 'live',
      batch: { withFiles: false },
      seed: {
        organizations: [KNOWN_ORG],
        closedStatus: { id: 'st-closed' },
        orders: [
          {
            id: 'ord-1',
            organizationId: 'org-1',
            externalId: '1c-1',
            orderNumber: '№1',
            totalAmount: '50000',
            closedAt: null,
            completedAt: null,
          },
        ],
      },
    });

    expect(nonZero(result.counts.order)).toEqual({ update: 1, create: 1 });
    // Привязка — это `updateMany` по сделке с пустым `orderId`: живая связь
    // важнее перенесённой, поэтому чужой заказ мы не перебиваем.
    expect(tx.deal.updateMany).toHaveBeenCalledWith({
      where: { id: 'deal-1', orderId: null },
      data: { orderId: 'ord-1' },
    });
    // Второй сделке заказа в 1С не нашлось — заводим заказ-историю со статусом.
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.orderStatusChange.create).toHaveBeenCalledWith({
      data: {
        orderId: 'order-1',
        fromId: null,
        toId: 'st-closed',
        userId: null,
        reason: 'Перенесено из Битрикс24',
      },
    });
    expect(result.errors).toEqual([]);
    // Привязку показываем всегда — человек должен видеть, К КАКОМУ заказу
    // прилипнет сделка; сделка без названия названа идентификатором.
    expect(reasonsOf(result, 'order')).toEqual(['470: заказ найден в 1С: №1']);
  });

  it('писатель бросил не ошибку, а строку — в отчёт всё равно попадает её текст', async () => {
    const source = makeSource({ companies: [company({ id: '101' })] });

    const { result } = await run({
      source,
      mode: 'live',
      batch: { withFiles: false },
      arrange: (t) => {
        t.organization.create.mockRejectedValueOnce('нет места на диске');
      },
    });

    // Бросить можно что угодно — человеку всё равно нужен текст, а не
    // «[object Object]» и не пустая строка в отчёте сверки.
    expect(result.errors).toEqual([
      { bitrixId: '101', entity: 'organization', message: 'нет места на диске' },
    ]);
    expect(reasonsOf(result, 'organization')).toEqual(['101: не записано: нет места на диске']);
  });

  it('журнал по одной и той же строке спрашивается один раз, а не на каждую запись', async () => {
    // Две компании портала с одним названием сходятся в одну организацию ЛК.
    const source = makeSource({
      companies: [
        company({ id: '101', title: 'Компания 101' }),
        company({ id: '102', title: 'Компания 101' }),
      ],
    });

    const { result, calls, tx } = await run({
      source,
      mode: 'live',
      batch: { withFiles: false },
      seed: {
        organizations: [KNOWN_ORG],
        journal: [
          {
            entity: 'organization',
            entityId: 'org-1',
            bitrixId: '101',
            after: { name: 'Компания 101' },
          },
        ],
      },
    });

    // Снимок прошлого прогона уже в памяти — второй круг к журналу лишний. На
    // пакете в десятки тысяч строк это разница между одним запросом и тысячами.
    expect(calls.journal).toHaveBeenCalledTimes(1);
    expect(nonZero(result.counts.organization)).toEqual({ update: 2 });
    expect(tx.organization.update).toHaveBeenCalledTimes(2);
  });

  it('вложение, не дошедшее до хранилища, уходит из «создадим» в «пропустили»', async () => {
    upload.mockRejectedValueOnce(new Error('S3 недоступен'));
    const source = makeSource({
      companies: [company({ id: '101' })],
      files: [
        {
          id: '703',
          entity: 'company',
          entityId: '101',
          name: 'реквизиты.pdf',
          size: 1,
          downloadUrl: null,
        },
      ],
    });

    const { result, tx } = await run({ source, mode: 'live' });

    // Файл не доехал — но это не повод останавливать перенос: в сводке он
    // честно уходит из «создадим» в «пропустили», а причина видна человеку.
    expect(nonZero(result.counts.file)).toEqual({ skip: 1 });
    expect(result.errors).toEqual([
      { bitrixId: '703', entity: 'file', message: 'хранилище файлов недоступно' },
    ]);
    expect(reasonsOf(result, 'file')).toEqual(['703: хранилище файлов недоступно']);
    expect(tx.document.create).not.toHaveBeenCalled();
    // Организация при этом записана: один битый файл не отменяет остального.
    expect(tx.organization.create).toHaveBeenCalledTimes(1);
  });
});

describe('runPipeline — повторный перенос заметок и контакт без имени', () => {
  it('заметка, перенесённая прошлым пакетом, пропускается как «уже связано»', async () => {
    const source = makeSource({
      companies: [company({ id: '101' })],
      comments: [
        {
          id: '606',
          entity: 'company',
          entityId: '101',
          authorId: null,
          text: 'Звонить после 14:00',
          createdAt: null,
        },
      ],
    });

    const { result, calls } = await run({
      source,
      // У заметок нет колонки `bitrixId`: без этой проверки повтор пакета
      // сделал бы копию каждой заметки.
      seed: { journal: [{ entity: 'note', entityId: 'n-1', bitrixId: '606' }] },
    });

    expect(calls.journal).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ entity: 'note' }) })
    );
    expect(nonZero(result.counts.note)).toEqual({ skip: 1 });
    expect(reasonsOf(result, 'note')).toEqual(['606: уже связано']);
  });

  it('контакт без имени в строке про занятый канал назван идентификатором', async () => {
    const source = makeSource({
      contacts: [
        contact({ id: '210', name: 'Вера', lastName: 'Смирнова', phones: ['+7 812 777 88 99'] }),
        // Имени нет, но почта своя: контакт заводится, а занятый телефон
        // остаётся у первого — об этом и строка отчёта.
        contact({
          id: '211',
          name: '',
          lastName: '',
          phones: ['+7 812 777 88 99'],
          emails: ['no-name@demo.local'],
        }),
      ],
    });

    const { result } = await run({ source });

    // Пустая строка вместо имени превратила бы строку отчёта в «канал не
    // перенесён у ««»» — человек не понял бы, о ком речь.
    expect(reasonsOf(result, 'contact')).toEqual([
      '211: канал не перенесён: +7 812 777 88 99 — уже у контакта «Вера Смирнова»',
    ]);
    expect(result.rows[0].title).toBe('211');
  });
});
