import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * История пакетов миграции из Битрикс24 (`У-198`, спека §3.6).
 *
 * Список отличается от карточки одним: у каждой строки посчитано, можно ли её
 * откатить и почему нельзя. Поэтому проверяется не «список вернулся», а то,
 * ради чего сервис написан: состояние кнопки «Откатить» с русским объяснением,
 * один запрос счётчиков на всю страницу (а не по запросу на пакет) и чужой
 * пакет, которого для сотрудника не существует.
 *
 * Prisma — объект с нужными методами: живой Postgres увёл бы файл в
 * integration-слой.
 */
vi.mock('@/lib/auth/audit', () => ({ recordAudit: vi.fn() }));
vi.mock('@/lib/jobs/queues', () => ({ getQueue: vi.fn(() => ({ add: vi.fn() })) }));
vi.mock('@/lib/logging', () => ({
  bestEffort: () => () => {},
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { getBitrixBatchWithRollback, listBitrixHistory } from '@/lib/services/bitrix/history';
import { ROLLBACK_STATE_HINTS } from '@/lib/services/bitrix/rollback';

const DAY = 24 * 60 * 60 * 1000;

const findManyBatches = vi.fn();
const findUniqueBatch = vi.fn();
const groupByWrites = vi.fn();
const countWrites = vi.fn();

const prisma = {
  bitrixImportBatch: { findMany: findManyBatches, findUnique: findUniqueBatch },
  bitrixImportWrite: { groupBy: groupByWrites, count: countWrites },
} as unknown as PrismaClient;

const admin = { sub: 'u1', role: 'admin', companyId: 'c1' } as SessionPayload;
const homeless = { sub: 'u1', role: 'admin', companyId: null } as SessionPayload;

/** Строка пакета в том виде, в каком её отдаёт `BATCH_SELECT` предпросмотра. */
function batchRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'b1',
    companyId: 'c1',
    status: 'applied',
    source: 'rest',
    mode: 'initial',
    createdAt: new Date('2026-09-01T12:00:00Z'),
    startedAt: new Date('2026-09-01T12:05:00Z'),
    appliedAt: new Date(Date.now() - DAY),
    rolledBackAt: null,
    reportPath: null,
    settings: {},
    counts: {},
    errors: null,
    importedBy: { name: 'Иван Менеджеров' },
    ...over,
  };
}

/** Ответ groupBy: сколько неоткаченных строк журнала у каждого пакета. */
function pending(map: Record<string, number>): { batchId: string; _count: { _all: number } }[] {
  return Object.entries(map).map(([batchId, n]) => ({ batchId, _count: { _all: n } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  findManyBatches.mockResolvedValue([batchRow()]);
  findUniqueBatch.mockResolvedValue(batchRow());
  groupByWrites.mockResolvedValue(pending({ b1: 3 }));
  countWrites.mockResolvedValue(3);
});

describe('listBitrixHistory — доступ и пустая история', () => {
  it('сотрудник без компании → forbidden, в базу не ходим', async () => {
    await expect(listBitrixHistory(prisma, homeless)).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(findManyBatches).not.toHaveBeenCalled();
    expect(groupByWrites).not.toHaveBeenCalled();
  });

  it('переносов ещё не было → пустой список и НИ ОДНОГО запроса счётчиков', async () => {
    findManyBatches.mockResolvedValue([]);
    await expect(listBitrixHistory(prisma, admin)).resolves.toEqual({ ok: true, batches: [] });
    expect(groupByWrites).not.toHaveBeenCalled();
  });

  it('история читается своей компанией и не длиннее пятидесяти строк', async () => {
    await listBitrixHistory(prisma, admin);
    expect(findManyBatches).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1' }, take: 50 })
    );
  });
});

describe('listBitrixHistory — состояние отката у каждой строки', () => {
  const page = [
    batchRow({ id: 'b-ok', status: 'applied', appliedAt: new Date(Date.now() - DAY) }),
    batchRow({ id: 'b-preview', status: 'preview', appliedAt: null }),
    batchRow({
      id: 'b-back',
      status: 'rolled_back',
      appliedAt: new Date(Date.now() - 2 * DAY),
      rolledBackAt: new Date(Date.now() - DAY),
    }),
    batchRow({ id: 'b-old', status: 'applied', appliedAt: new Date(Date.now() - 40 * DAY) }),
    batchRow({ id: 'b-empty', status: 'applied', appliedAt: new Date(Date.now() - DAY) }),
    batchRow({
      id: 'b-partial',
      status: 'rollback_partial',
      appliedAt: new Date(Date.now() - DAY),
    }),
  ];

  beforeEach(() => {
    findManyBatches.mockResolvedValue(page);
    // У `b-empty` неоткаченных строк нет — его в ответе groupBy просто нет.
    groupByWrites.mockResolvedValue(pending({ 'b-ok': 5, 'b-old': 5, 'b-partial': 2 }));
  });

  it('применённый пакет со строками журнала → «откатить можно», подсказки нет', async () => {
    const res = await listBitrixHistory(prisma, admin);
    if (!res.ok) throw new Error('ожидался успешный ответ');
    const row = res.batches.find((b) => b.id === 'b-ok');
    expect(row?.rollback).toBe('available');
    // Пустая подсказка — это и есть «кнопка активна, объяснять нечего».
    expect(row?.rollbackHint).toBe('');
  });

  it('остальные состояния: не применён, откачен, просрочен, нечего возвращать', async () => {
    const res = await listBitrixHistory(prisma, admin);
    if (!res.ok) throw new Error('ожидался успешный ответ');
    const state = Object.fromEntries(res.batches.map((b) => [b.id, b.rollback]));

    expect(state).toEqual({
      'b-ok': 'available',
      'b-preview': 'not_applied',
      'b-back': 'rolled_back',
      'b-old': 'expired',
      'b-empty': 'nothing_to_revert',
      'b-partial': 'available',
    });
  });

  it('у неактивной кнопки подсказка объясняет причину человеку', async () => {
    const res = await listBitrixHistory(prisma, admin);
    if (!res.ok) throw new Error('ожидался успешный ответ');
    const hint = Object.fromEntries(res.batches.map((b) => [b.id, b.rollbackHint]));

    // Подсказка берётся из общего словаря — подпись кнопки и поведение отката
    // считаются по одним и тем же данным и разъехаться не могут.
    expect(hint['b-preview']).toBe(ROLLBACK_STATE_HINTS.not_applied);
    expect(hint['b-preview']).toContain('не применён');
    expect(hint['b-back']).toBe(ROLLBACK_STATE_HINTS.rolled_back);
    expect(hint['b-old']).toBe(ROLLBACK_STATE_HINTS.expired);
    expect(hint['b-old']).toContain('30 дней');
    expect(hint['b-empty']).toBe(ROLLBACK_STATE_HINTS.nothing_to_revert);
  });

  it('счётчик неоткаченных строк — ОДИН запрос на всю страницу (защита от N+1)', async () => {
    await listBitrixHistory(prisma, admin);

    expect(groupByWrites).toHaveBeenCalledTimes(1);
    expect(groupByWrites).toHaveBeenCalledWith({
      by: ['batchId'],
      where: {
        batchId: { in: ['b-ok', 'b-preview', 'b-back', 'b-old', 'b-empty', 'b-partial'] },
        reverted: false,
      },
      _count: { _all: true },
    });
    // Ни одного «досчитаю по пакету» — иначе пятьдесят строк дали бы пятьдесят запросов.
    expect(countWrites).not.toHaveBeenCalled();
  });

  it('карточка пакета остаётся на месте: состояние отката только добавляется', async () => {
    const res = await listBitrixHistory(prisma, admin);
    if (!res.ok) throw new Error('ожидался успешный ответ');
    const row = res.batches.find((b) => b.id === 'b-ok');

    expect(row).toMatchObject({
      id: 'b-ok',
      status: 'applied',
      source: 'rest',
      mode: 'initial',
      importedByName: 'Иван Менеджеров',
      rollback: 'available',
    });
  });
});

describe('listBitrixHistory — кнопка «Отчёт»', () => {
  it('hasReport только у пакета с сохранённым путём отчёта', async () => {
    findManyBatches.mockResolvedValue([
      batchRow({
        id: 'b-with',
        reportPath: 'bitrix-import/b-with/report-2026-09-13T10-00-00-000Z.xlsx',
      }),
      batchRow({ id: 'b-without', reportPath: null }),
    ]);
    groupByWrites.mockResolvedValue(pending({ 'b-with': 1, 'b-without': 1 }));

    const res = await listBitrixHistory(prisma, admin);
    if (!res.ok) throw new Error('ожидался успешный ответ');
    expect(Object.fromEntries(res.batches.map((b) => [b.id, b.hasReport]))).toEqual({
      'b-with': true,
      'b-without': false,
    });
  });
});

describe('getBitrixBatchWithRollback', () => {
  it('сотрудник без компании → forbidden', async () => {
    await expect(getBitrixBatchWithRollback(prisma, homeless, 'b1')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    });
    expect(countWrites).not.toHaveBeenCalled();
  });

  it('пакет чужой компании → not_found, строки журнала не считаем', async () => {
    findUniqueBatch.mockResolvedValue(batchRow({ companyId: 'c2' }));
    await expect(getBitrixBatchWithRollback(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(countWrites).not.toHaveBeenCalled();
  });

  it('пакета нет вовсе → not_found', async () => {
    findUniqueBatch.mockResolvedValue(null);
    await expect(getBitrixBatchWithRollback(prisma, admin, 'b1')).resolves.toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('успех: та же карточка плюс состояние отката и подсказка', async () => {
    const res = await getBitrixBatchWithRollback(prisma, admin, 'b1');
    if (!res.ok) throw new Error('ожидался успешный ответ');

    expect(res.batch).toMatchObject({
      id: 'b1',
      status: 'applied',
      importedByName: 'Иван Менеджеров',
      rollback: 'available',
      rollbackHint: '',
    });
    expect(countWrites).toHaveBeenCalledWith({ where: { batchId: 'b1', reverted: false } });
  });

  it('применён, но неоткаченных строк нет → «нечего возвращать» с объяснением', async () => {
    countWrites.mockResolvedValue(0);
    const res = await getBitrixBatchWithRollback(prisma, admin, 'b1');
    if (!res.ok) throw new Error('ожидался успешный ответ');

    expect(res.batch.rollback).toBe('nothing_to_revert');
    expect(res.batch.rollbackHint).toBe(ROLLBACK_STATE_HINTS.nothing_to_revert);
  });

  it('пакет применён 40 дней назад → окно отката закрыто', async () => {
    findUniqueBatch.mockResolvedValue(batchRow({ appliedAt: new Date(Date.now() - 40 * DAY) }));
    const res = await getBitrixBatchWithRollback(prisma, admin, 'b1');
    if (!res.ok) throw new Error('ожидался успешный ответ');

    expect(res.batch.rollback).toBe('expired');
    expect(res.batch.rollbackHint).toBe(ROLLBACK_STATE_HINTS.expired);
  });
});
