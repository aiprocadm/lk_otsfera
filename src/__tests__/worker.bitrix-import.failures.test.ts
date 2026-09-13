/**
 * Пакет миграции из Битрикс24 — краевые пути процессора (`У-196`, `У-202`).
 *
 * Счастливый путь и живая база — в `worker.bitrix-import.integration`. Здесь
 * проверяется то, что на живой базе не воспроизвести: сам сервис отката упал
 * посреди работы, упал «не ошибкой» (кто-то бросил строку), а у пакета в базе
 * вместо настроек лежит `null`.
 *
 * Правило у всех трёх случаев одно: задача НЕ уходит в бесконечные повторы, а
 * пакет переходит в `failed` с текстом, который человек прочитает на экране —
 * молчаливое зависание в «откатываем» было бы дефектом приёмки (§15).
 *
 * Prisma — объект с нужными методами: живой Postgres увёл бы файл в
 * integration-слой (vitest.config.ts делит слои по конструктору клиента прямо
 * в тексте теста, поэтому здесь его нет даже в комментарии).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { Job } from 'bullmq';

// Очередь тянется в граф импортов через сервисы пакета — Redis тесту не нужен.
vi.mock('@/lib/jobs/queues', () => ({
  getQueue: vi.fn(() => ({ add: vi.fn(async () => undefined) })),
}));

const { runRollback, storeBitrixReport } = vi.hoisted(() => ({
  runRollback: vi.fn(),
  storeBitrixReport: vi.fn(async () => null),
}));
// Подменяем ТОЛЬКО две функции: остальные экспорты этих модулей нужны их
// соседям по графу импортов, и обрубать их целиком нельзя.
vi.mock('@/lib/services/bitrix/rollback', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bitrix/rollback')>()),
  runRollback,
}));
vi.mock('@/lib/services/bitrix/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/bitrix/report')>()),
  storeBitrixReport,
}));

import { bitrixImportProcessor } from '@/worker/processors/bitrix-import';
import type { BitrixImportJobPayload } from '@/lib/jobs/types';
import type { RollbackConflict, RollbackSummary } from '@/lib/services/bitrix/rollback';

type BatchRow = {
  id: string;
  companyId: string;
  importedById: string;
  source: string;
  /** Прежнее состояние пакета: в него откат возвращается, если упал. */
  status: string;
  settings: unknown;
};

type BatchUpdate = { where: { id: string }; data: Record<string, unknown> };

let batch: BatchRow | null = null;
const updates: BatchUpdate[] = [];
const audits: { data: Record<string, unknown> }[] = [];

const db = {
  bitrixImportBatch: {
    findUnique: vi.fn(async () => batch),
    update: vi.fn(async (args: BatchUpdate) => {
      updates.push(args);
      return {};
    }),
  },
  // Настройки флагов праймятся из той же таблицы: пустой ответ = «в базе не
  // задано», значение берётся из переменной окружения ниже.
  integrationSetting: { findMany: vi.fn(async () => []) },
  auditLog: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      audits.push(args);
      return {};
    }),
  },
} as unknown as PrismaClient;

function job(name: string, batchId = 'b-1'): Job<BitrixImportJobPayload> {
  return { id: 'unit-bitrix-import', name, data: { batchId } } as Job<BitrixImportJobPayload>;
}

/** Последняя запись в пакет — именно её человек увидит в списке. */
function lastUpdate(): BatchUpdate {
  const last = updates[updates.length - 1];
  if (!last) throw new Error('процессор не тронул пакет ни разу');
  return last;
}

const CONFLICT: RollbackConflict = {
  entity: 'order',
  entityId: 'o-1',
  label: 'Поставка щитов',
  code: 'order_has_payments',
  count: 2,
};

const SUMMARY: RollbackSummary = {
  status: 'rolled_back',
  reverted: 3,
  deleted: 2,
  restored: 1,
  unlinked: 0,
  conflicts: [CONFLICT],
  errors: [],
};

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  audits.length = 0;
  batch = {
    id: 'b-1',
    companyId: 'c-1',
    importedById: 'u-1',
    source: 'rest',
    status: 'applied',
    settings: { withFiles: true },
  };
  process.env.FEATURE_BITRIX_MIGRATION = '1';
  storeBitrixReport.mockResolvedValue(null);
  // В тестовом окружении логгер — passthrough в console: глушим шум и заодно
  // проверяем, что причина падения вообще попала в журнал.
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FEATURE_BITRIX_MIGRATION;
});

describe('bitrixImportProcessor — откат упал', () => {
  it('сервис отката бросил ошибку: пакет переходит в «не удалось» с её текстом', async () => {
    runRollback.mockRejectedValue(new Error('база разорвала соединение'));

    const result = await bitrixImportProcessor(job('rollback'), db);

    expect(result).toEqual({
      batchId: 'b-1',
      status: 'failed',
      reason: 'база разорвала соединение',
    });
    // Пакет обязан сойти с «откатываем» — иначе завис бы там навсегда, — но
    // вернуться именно в ПРЕЖНЕЕ состояние: `failed` кнопка «Откатить» читает
    // как «пакет не применяли», и повторить откат было бы нечем.
    expect(lastUpdate().data.status).toBe('applied');
    expect(JSON.stringify(lastUpdate().data.errors)).toContain('база разорвала соединение');
    expect(warn).toHaveBeenCalledWith('[worker] bitrix-import rollback failed', {
      batchId: 'b-1',
      message: 'база разорвала соединение',
    });
    // Ни отчёта, ни записи «откачено» — откат не состоялся, врать нельзя.
    expect(storeBitrixReport).not.toHaveBeenCalled();
    expect(audits).toEqual([]);
  });

  it('бросили не ошибку, а строку — причина всё равно читается человеком', async () => {
    // Так падают чужие библиотеки: `throw 'текст'` вместо `throw new Error`.
    // Без приведения к строке человек увидел бы пустое «не удалось».
    runRollback.mockRejectedValue('портал ответил не по-человечески');

    const result = await bitrixImportProcessor(job('rollback'), db);

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'портал ответил не по-человечески',
    });
    expect(JSON.stringify(lastUpdate().data.errors)).toContain('портал ответил не по-человечески');
  });
});

describe('bitrixImportProcessor — краевые данные пакета', () => {
  it('у пакета вместо настроек null: откат проходит, конфликты записываются', async () => {
    // Пакет мог быть заведён до появления настроек — пустое поле не повод
    // терять список конфликтов, ради которого и собирается отчёт сверки.
    batch = { ...(batch as BatchRow), settings: null };
    runRollback.mockResolvedValue(SUMMARY);

    const result = await bitrixImportProcessor(job('rollback'), db);

    expect(result).toEqual({ batchId: 'b-1', status: 'rolled_back' });
    const data = lastUpdate().data;
    expect(data.status).toBe('rolled_back');
    expect(data.rolledBackAt).toBeInstanceOf(Date);
    expect(data.settings).toEqual({ rollbackConflicts: [CONFLICT] });
    expect(storeBitrixReport).toHaveBeenCalledWith(db, 'b-1');
    expect(audits[0]?.data).toMatchObject({
      userId: 'u-1',
      action: 'bitrix_import_rolled_back',
      entityId: 'b-1',
    });
  });

  it('прогон бросил не ошибку, а строку: применение тоже объясняет причину', async () => {
    const result = await bitrixImportProcessor(job('apply'), db, {
      getSource: async () => {
        throw 'вебхук портала вернул пустой ответ';
      },
    });

    expect(result).toMatchObject({
      status: 'failed',
      reason: 'вебхук портала вернул пустой ответ',
    });
    // Сначала пакет встал в «применяем», потом честно сошёл в «не удалось».
    expect(updates.map((u) => u.data.status)).toEqual(['applying', 'failed']);
    expect(warn).toHaveBeenCalledWith('[worker] bitrix-import apply failed', {
      batchId: 'b-1',
      message: 'вебхук портала вернул пустой ответ',
    });
  });
});
