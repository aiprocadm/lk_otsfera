import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Пакет миграции из Битрикс24 (`У-193`, спека §3.2): создание, чтение, правка
 * таблиц сопоставления и состояние для опроса с экрана.
 *
 * Проверяется то, ради чего сервис написан: чужой пакет для сотрудника не
 * существует (`not_found`, а не «нет доступа»), настройки читаются с
 * умолчаниями (старый пакет без новых полей не должен ломать экран), «готов к
 * применению» — только при сопоставленных стадиях, а недоступная очередь не
 * роняет создание пакета (§3 CLAUDE.md). Prisma — объект с нужными методами:
 * живой Postgres увёл бы файл в integration-слой.
 */
const { recordAudit } = vi.hoisted(() => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/auth/audit', () => ({ recordAudit }));

const { getQueue, queueAdd } = vi.hoisted(() => {
  const queueAdd = vi.fn();
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

import {
  applyBitrixBatch,
  batchReadyToApply,
  createBitrixBatch,
  filterOf,
  getBitrixBatch,
  getBitrixBatchState,
  listBitrixBatches,
  saveBatchMapping,
  type BitrixBatchSettings,
} from '@/lib/services/bitrix/preview';
import type { BitrixStage } from '@/lib/services/bitrix/source';

const create = vi.fn();
const findUnique = vi.fn();
const findMany = vi.fn();
const update = vi.fn();
const prisma = {
  bitrixImportBatch: { create, findUnique, findMany, update },
} as unknown as PrismaClient;

const admin = { sub: 'u1', role: 'admin', companyId: 'c1' } as SessionPayload;
const homeless = { sub: 'u1', role: 'admin', companyId: null } as SessionPayload;

const STAGES: BitrixStage[] = [
  { entity: 'deal', categoryId: null, id: 'NEW', name: 'Новая', semantics: 'process' },
  { entity: 'lead', categoryId: null, id: 'JUNK', name: 'Некачественный', semantics: 'failure' },
];
const FULL_TABLES = {
  stageMap: { '0:NEW': 'ds-1' },
  leadStageMap: { JUNK: 'fs-1' },
};

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    companyId: 'c1',
    status: 'preview',
    source: 'rest',
    mode: 'initial',
    createdAt: new Date('2026-09-13T10:00:00Z'),
    startedAt: null,
    appliedAt: null,
    settings: { stagesFound: STAGES, tables: FULL_TABLES },
    counts: {},
    errors: null,
    importedBy: { name: 'Иван Менеджеров' },
    ...over,
  };
}

const ARGS = {
  source: 'rest' as const,
  from: '2025-01-01',
  to: '2026-01-01',
  openOnly: false,
  withFiles: true,
  defaultManagerId: 'm1',
  fileKeys: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 'b1' });
  findUnique.mockResolvedValue(row());
  findMany.mockResolvedValue([row()]);
  update.mockResolvedValue({});
  queueAdd.mockResolvedValue({});
  recordAudit.mockResolvedValue(undefined);
});

describe('createBitrixBatch', () => {
  it('сотрудник без компании → forbidden, пакет не заводится', async () => {
    await expect(createBitrixBatch(prisma, homeless, ARGS)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('неизвестный источник → invalid', async () => {
    await expect(
      createBitrixBatch(prisma, admin, { ...ARGS, source: 'csv' as unknown as 'rest' })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it('источник file без ключей файлов → invalid', async () => {
    await expect(
      createBitrixBatch(prisma, admin, { ...ARGS, source: 'file', fileKeys: [] })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it('счастливый путь: строка пакета, задача в очереди и запись в аудит', async () => {
    await expect(createBitrixBatch(prisma, admin, ARGS)).resolves.toEqual({
      ok: true,
      batchId: 'b1',
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        companyId: 'c1',
        importedById: 'u1',
        source: 'rest',
        mode: 'initial',
        status: 'preview_pending',
        settings: {
          from: '2025-01-01',
          to: '2026-01-01',
          openOnly: false,
          withFiles: true,
          defaultManagerId: 'm1',
          fileKeys: [],
          tables: {},
        },
        counts: {},
      },
      select: { id: true },
    });
    expect(getQueue).toHaveBeenCalledWith('bitrix.import');
    expect(queueAdd).toHaveBeenCalledWith('preview', { batchId: 'b1' });
    expect(recordAudit).toHaveBeenCalledWith(prisma, {
      userId: 'u1',
      action: 'bitrix_import_previewed',
      entity: 'bitrix_import_batch',
      entityId: 'b1',
      after: { source: 'rest', openOnly: false, withFiles: true },
    });
  });

  it('пустые период и менеджер по умолчанию превращаются в null, ключи файлов сохраняются', async () => {
    const fileKeys = [{ key: 'k1', name: 'companies.csv', entity: 'company' }];
    await createBitrixBatch(prisma, admin, {
      ...ARGS,
      source: 'file',
      from: '',
      to: '',
      openOnly: true,
      withFiles: false,
      defaultManagerId: '',
      fileKeys,
    });

    expect(create.mock.calls[0][0].data.settings).toEqual({
      from: null,
      to: null,
      openOnly: true,
      withFiles: false,
      defaultManagerId: null,
      fileKeys,
      tables: {},
    });
  });

  it('очередь недоступна — пакет всё равно создан, отказ уходит в журнал', async () => {
    const err = new Error('redis down');
    queueAdd.mockRejectedValue(err);

    await expect(createBitrixBatch(prisma, admin, ARGS)).resolves.toEqual({
      ok: true,
      batchId: 'b1',
    });
    expect(swallowed).toHaveBeenCalledWith('[bitrix/preview] enqueue failed', err);
    // Аудит пишется и в этом случае: пакет существует, человек его увидит.
    expect(recordAudit).toHaveBeenCalled();
  });
});

describe('getBitrixBatch', () => {
  it('сотрудник без компании → forbidden, база не спрашивается', async () => {
    await expect(getBitrixBatch(prisma, homeless, 'b1')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('нет пакета и чужой пакет неразличимы → not_found', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(getBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });

    findUnique.mockResolvedValueOnce(row({ companyId: 'c2' }));
    await expect(getBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('пакет без настроек читается с умолчаниями, пустая сводка → null', async () => {
    findUnique.mockResolvedValue(row({ settings: null, counts: {}, errors: 'мусор' }));

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.batch.settings).toEqual({
      from: null,
      to: null,
      openOnly: false,
      // Файлы по умолчанию включены: пакет старого формата их переносил.
      withFiles: true,
      defaultManagerId: null,
      fileKeys: [],
      tables: {},
    });
    expect(res.batch.counts).toBeNull();
    expect(res.batch.errors).toEqual([]);
    expect(res.batch.importedByName).toBe('Иван Менеджеров');
    // Стадий не нашли — применять нечего.
    expect(res.batch.ready).toBe(false);
  });

  it('конфликты отката доезжают из настроек в карточку пакета', async () => {
    // Их записал откат (`У-196`), а показывает отчёт сверки. Потеряйся они при
    // чтении — человек увидел бы «откачен частично» без единой причины.
    findUnique.mockResolvedValue(
      row({
        status: 'rollback_partial',
        rolledBackAt: new Date('2026-09-14T10:00:00Z'),
        reportPath: 'bitrix-import/b1/report.xlsx',
        settings: {
          stagesFound: STAGES,
          tables: FULL_TABLES,
          rollbackConflicts: [
            {
              entity: 'order',
              entityId: 'o1',
              label: 'ЗК-7',
              code: 'order_has_payments',
              count: 2,
            },
          ],
        },
      })
    );

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.batch.settings.rollbackConflicts).toEqual([
      { entity: 'order', entityId: 'o1', label: 'ЗК-7', code: 'order_has_payments', count: 2 },
    ]);
    expect(res.batch.hasReport).toBe(true);
    expect(res.batch.rolledBackAt).toEqual(new Date('2026-09-14T10:00:00Z'));
  });

  it('настройки старого пакета: openOnly не-true и мусорные fileKeys приводятся к форме', async () => {
    findUnique.mockResolvedValue(
      row({
        settings: {
          from: '2025-01-01',
          to: '2026-01-01',
          openOnly: 'да',
          withFiles: false,
          defaultManagerId: 'm1',
          fileKeys: 'k1',
          tables: FULL_TABLES,
        },
      })
    );

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok && res.batch.settings).toMatchObject({
      from: '2025-01-01',
      to: '2026-01-01',
      openOnly: false,
      withFiles: false,
      defaultManagerId: 'm1',
      fileKeys: [],
    });
  });

  it('находки сухого прогона попадают в настройки как есть', async () => {
    const usersFound = [
      { bitrixId: '1', name: 'Иван', email: null, userId: 'u1', matchedBy: 'table' as const },
    ];
    const rows = [
      { entity: 'note' as const, bitrixId: '609', title: 'Комментарий', action: 'skip' as const },
    ];
    findUnique.mockResolvedValue(
      row({ settings: { stagesFound: STAGES, tables: FULL_TABLES, usersFound, rows } })
    );

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok && res.batch.settings.stagesFound).toEqual(STAGES);
    expect(res.ok && res.batch.settings.usersFound).toEqual(usersFound);
    expect(res.ok && res.batch.settings.rows).toEqual(rows);
  });

  it('сводки ещё нет (колонка пуста) → counts остаётся null', async () => {
    findUnique.mockResolvedValue(row({ counts: null }));

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok && res.batch.counts).toBeNull();
  });

  it('сводка и ошибки прогона отдаются экрану', async () => {
    const counts = { total: 43, warnings: [], progress: null };
    const errors = [{ bitrixId: '401', entity: 'deal', message: 'нет стадии' }];
    findUnique.mockResolvedValue(row({ counts, errors }));

    const res = await getBitrixBatch(prisma, admin, 'b1');

    expect(res.ok && res.batch.counts).toEqual(counts);
    expect(res.ok && res.batch.errors).toEqual(errors);
  });

  it('готов к применению — только предпросмотр со всеми сопоставленными стадиями', async () => {
    const ready = await getBitrixBatch(prisma, admin, 'b1');
    expect(ready.ok && ready.batch.ready).toBe(true);
    expect(ready.ok && batchReadyToApply(ready.batch)).toBe(true);

    // Стадия сделки осталась без пары — применять нельзя.
    findUnique.mockResolvedValue(
      row({ settings: { stagesFound: STAGES, tables: { leadStageMap: FULL_TABLES.leadStageMap } } })
    );
    const partial = await getBitrixBatch(prisma, admin, 'b1');
    expect(partial.ok && partial.batch.ready).toBe(false);

    // Статус лида без пары — то же самое.
    findUnique.mockResolvedValue(
      row({ settings: { stagesFound: STAGES, tables: { stageMap: FULL_TABLES.stageMap } } })
    );
    const partialLead = await getBitrixBatch(prisma, admin, 'b1');
    expect(partialLead.ok && partialLead.batch.ready).toBe(false);

    // Сопоставление полное, но пакет уже применён — «готов» больше не про него.
    findUnique.mockResolvedValue(row({ status: 'applied' }));
    const applied = await getBitrixBatch(prisma, admin, 'b1');
    expect(applied.ok && applied.batch.ready).toBe(false);
    expect(applied.ok && batchReadyToApply(applied.batch)).toBe(false);
  });
});

describe('listBitrixBatches', () => {
  it('сотрудник без компании → forbidden', async () => {
    await expect(listBitrixBatches(prisma, homeless)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('свежие сверху, только своя компания, по умолчанию не больше 20', async () => {
    const res = await listBitrixBatches(prisma, admin);

    expect(res.ok && res.batches).toHaveLength(1);
    expect(res.ok && res.batches[0].id).toBe('b1');
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: { companyId: 'c1' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
  });

  it('ограничение задаётся вызовом', async () => {
    await listBitrixBatches(prisma, admin, 5);
    expect(findMany.mock.calls[0][0].take).toBe(5);
  });
});

describe('getBitrixBatchState', () => {
  it('сотрудник без компании → forbidden; чужой и отсутствующий пакет → not_found', async () => {
    await expect(getBitrixBatchState(prisma, homeless, 'b1')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findUnique).not.toHaveBeenCalled();

    findUnique.mockResolvedValueOnce(null);
    await expect(getBitrixBatchState(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });

    findUnique.mockResolvedValueOnce({ companyId: 'c2', status: 'preview', counts: {} });
    await expect(getBitrixBatchState(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('статус и прогресс; сводки ещё нет → прогресс null', async () => {
    findUnique.mockResolvedValue({ companyId: 'c1', status: 'preview_pending', counts: null });
    await expect(getBitrixBatchState(prisma, admin, 'b1')).resolves.toEqual({
      ok: true,
      status: 'preview_pending',
      progress: null,
    });

    const progress = {
      step: 'deal' as const,
      done: 12,
      total: 12,
      updatedAt: '2026-09-13T10:00:00Z',
    };
    findUnique.mockResolvedValue({ companyId: 'c1', status: 'applying', counts: { progress } });
    await expect(getBitrixBatchState(prisma, admin, 'b1')).resolves.toEqual({
      ok: true,
      status: 'applying',
      progress,
    });
    // Опрос с экрана не тянет настройки пакета — только три поля.
    expect(findUnique.mock.calls[0][0].select).toEqual({
      companyId: true,
      status: true,
      counts: true,
    });
  });
});

describe('saveBatchMapping', () => {
  it('отказ чтения передаётся как есть, ничего не пишем', async () => {
    await expect(
      saveBatchMapping(prisma, homeless, { batchId: 'b1', tables: {} })
    ).resolves.toEqual({ ok: false, error: 'forbidden' });

    findUnique.mockResolvedValueOnce(null);
    await expect(saveBatchMapping(prisma, admin, { batchId: 'b1', tables: {} })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('пакет не в предпросмотре → invalid: правка таблиц уже ничего не изменит', async () => {
    findUnique.mockResolvedValue(row({ status: 'applied' }));

    await expect(
      saveBatchMapping(prisma, admin, { batchId: 'b1', tables: { stageMap: { '0:NEW': 'ds-2' } } })
    ).resolves.toEqual({ ok: false, error: 'invalid' });
    expect(update).not.toHaveBeenCalled();
  });

  it('новые таблицы сливаются с прежними настройками пакета', async () => {
    findUnique.mockResolvedValue(
      row({
        settings: {
          from: '2025-01-01',
          to: null,
          openOnly: true,
          withFiles: false,
          defaultManagerId: 'm1',
          fileKeys: [],
          stagesFound: STAGES,
          tables: { stageMap: { '0:NEW': 'ds-1' }, userMap: { '1': 'u1' } },
        },
      })
    );

    await expect(
      saveBatchMapping(prisma, admin, {
        batchId: 'b1',
        tables: { stageMap: { '0:NEW': 'ds-9' }, leadStageMap: { JUNK: 'fs-1' } },
      })
    ).resolves.toEqual({ ok: true });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: {
        settings: {
          from: '2025-01-01',
          to: null,
          openOnly: true,
          withFiles: false,
          defaultManagerId: 'm1',
          fileKeys: [],
          stagesFound: STAGES,
          // Решение человека по стадии сделки заменило прежнее целиком,
          // а таблица пользователей осталась на месте.
          tables: {
            stageMap: { '0:NEW': 'ds-9' },
            leadStageMap: { JUNK: 'fs-1' },
            userMap: { '1': 'u1' },
          },
        },
      },
    });
  });
});

describe('applyBitrixBatch', () => {
  it('отказ чтения передаётся как есть: чужой пакет — not_found, статус не трогаем', async () => {
    await expect(applyBitrixBatch(prisma, homeless, 'b1')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });

    findUnique.mockResolvedValueOnce(null);
    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });

    findUnique.mockResolvedValueOnce(row({ companyId: 'c2' }));
    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });

    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('пакет не в предпросмотре → invalid: применять дважды нечего', async () => {
    findUnique.mockResolvedValue(row({ status: 'applied' }));

    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('стадия без пары → mapping_incomplete: пакет остаётся в предпросмотре', async () => {
    // Несопоставленная стадия — жёсткий запрет: сделки легли бы не туда, и
    // пришлось бы откатывать весь перенос.
    findUnique.mockResolvedValue(
      row({ settings: { stagesFound: STAGES, tables: { stageMap: FULL_TABLES.stageMap } } })
    );

    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'mapping_incomplete',
    });
    expect(update).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('счастливый путь: пакет уходит в applying и задача «apply» встаёт в очередь', async () => {
    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({ ok: true });

    expect(update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'applying' } });
    expect(getQueue).toHaveBeenCalledWith('bitrix.import');
    expect(queueAdd).toHaveBeenCalledWith('apply', { batchId: 'b1' });
  });

  it('очередь недоступна — применение всё равно принято, отказ уходит в журнал', async () => {
    const err = new Error('redis down');
    queueAdd.mockRejectedValue(err);

    // Статус уже «applying», и человек нажмёт «Повторить», когда воркер
    // поднимется (§3 CLAUDE.md): падать на недоступной очереди нельзя.
    await expect(applyBitrixBatch(prisma, admin, 'b1')).resolves.toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { status: 'applying' } });
    expect(swallowed).toHaveBeenCalledWith('[bitrix/apply] enqueue failed', err);
  });
});

describe('filterOf', () => {
  const base: BitrixBatchSettings = {
    from: null,
    to: null,
    openOnly: false,
    withFiles: true,
    defaultManagerId: null,
    fileKeys: [],
    tables: {},
  };

  it('пустые границы — вся история', () => {
    expect(filterOf(base)).toEqual({ openOnly: false });
  });

  it('обе границы разбираются в даты', () => {
    expect(filterOf({ ...base, from: '2025-01-01', to: '2026-01-01', openOnly: true })).toEqual({
      from: new Date('2025-01-01'),
      to: new Date('2026-01-01'),
      openOnly: true,
    });
  });

  it('кривая дата не превращается в Invalid Date, а просто исчезает', () => {
    expect(filterOf({ ...base, from: 'вчера', to: '2026-01-01' })).toEqual({
      to: new Date('2026-01-01'),
      openOnly: false,
    });
    expect(filterOf({ ...base, from: '2025-01-01', to: 'позавчера' })).toEqual({
      from: new Date('2025-01-01'),
      openOnly: false,
    });
  });
});
