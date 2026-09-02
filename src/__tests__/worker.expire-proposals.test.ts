import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { setDocumentStatus, logWarn, logError, logInfo } = vi.hoisted(() => ({
  setDocumentStatus: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
}));
vi.mock('@/lib/services/documents/status', () => ({ setDocumentStatus }));
vi.mock('@/lib/logging', () => ({
  log: { warn: logWarn, error: logError, info: logInfo },
}));

import { runExpireProposals } from '@/worker/processors/expire-proposals';
import { expiredProposalsWhere } from '@/lib/documents/proposalExpiry';

/**
 * `У-164` (этап 7) — ночная задача «истёк срок предложения».
 *
 * Проверяем не «перевела статус», а то, ради чего задачу вообще писали руками,
 * а не одним `updateMany`: каждая бумага проходит через единственную дверь к
 * статусу, у каждой остаётся строка в журнале, и одна сломанная строка не
 * убивает весь ночной заход.
 */
const NOW = new Date('2026-09-16T22:00:00.000Z');

function makePrisma(docs: Array<{ id: string; sentById: string | null }>) {
  // Аргумент объявлен явно: без него `mock.calls` получает пустой кортеж, и
  // обращение к `calls[0][0]` не собирается.
  const findMany = vi.fn(async (args: { where?: unknown; take?: number; orderBy?: unknown }) => {
    void args;
    return docs;
  });
  const prisma = { document: { findMany } } as unknown as PrismaClient;
  return { prisma, findMany };
}

beforeEach(() => {
  vi.clearAllMocks();
  setDocumentStatus.mockResolvedValue({ ok: true });
});

describe('runExpireProposals — выборка', () => {
  it('берёт ровно то, что считает истёкшим общий расчёт', () => {
    // Собственного условия у задачи нет и быть не должно: разойдись оно с
    // расчётом на экране — карточка и база сказали бы разное.
    const { prisma, findMany } = makePrisma([]);
    return runExpireProposals(prisma, NOW).then(() => {
      expect(findMany.mock.calls[0]![0].where).toEqual(expiredProposalsWhere(NOW));
    });
  });

  it('порция ограничена и берётся с самых давних — остаток добьётся завтра', async () => {
    const { prisma, findMany } = makePrisma([]);
    await runExpireProposals(prisma, NOW);
    expect(findMany.mock.calls[0]![0].take).toBe(500);
    expect(findMany.mock.calls[0]![0].orderBy).toEqual({ validUntil: 'asc' });
  });

  it('истекать нечего — тихий заход без единого обращения к двери статусов', async () => {
    const { prisma } = makePrisma([]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 0,
      skippedNoActor: 0,
      failed: 0,
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });
});

describe('runExpireProposals — перевод статуса', () => {
  it('каждая бумага идёт через дверь статусов ПО ОТДЕЛЬНОСТИ', async () => {
    // Одним `updateMany` в журнале не осталось бы ни строки, и «когда истёк
    // этот документ» выяснить было бы нечем.
    const { prisma } = makePrisma([
      { id: 'd1', sentById: 'u1' },
      { id: 'd2', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toMatchObject({ expired: 2, failed: 0 });
    expect(setDocumentStatus).toHaveBeenCalledTimes(2);
    expect(setDocumentStatus.mock.calls[0]![2]).toEqual({ documentId: 'd1', to: 'expired' });
  });

  it('действие приписывается ОТПРАВИТЕЛЮ — по его воле пошёл срок', async () => {
    // Системного пользователя в проекте нет, а `AuditLog.userId` обязателен.
    // Ближайший честный ответ на «по чьей воле это произошло» — тот, кто
    // отправил предложение клиенту.
    const { prisma } = makePrisma([{ id: 'd1', sentById: 'u-sender' }]);
    await runExpireProposals(prisma, NOW);
    expect(setDocumentStatus.mock.calls[0]![1]).toMatchObject({ sub: 'u-sender' });
  });

  it('без отправителя бумага пропускается, а не подписывается кем попало', async () => {
    // Выдумать автора в журнале хуже, чем оставить документ как есть: такое
    // бывает у бумаг, приехавших извне, и переведёт их человек руками.
    const { prisma } = makePrisma([{ id: 'd1', sentById: null }]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 0,
      skippedNoActor: 1,
      failed: 0,
    });
    expect(setDocumentStatus).not.toHaveBeenCalled();
  });
});

describe('runExpireProposals — одна плохая строка не рушит заход', () => {
  it('отказ двери статусов считается и записывается, остальные продолжают', async () => {
    // Отказ означает, что выборка и матрица переходов разошлись, — молчать
    // нельзя, но и ронять ночной заход из-за одной бумаги тоже.
    setDocumentStatus
      .mockResolvedValueOnce({ ok: false, error: 'invalid_transition' })
      .mockResolvedValueOnce({ ok: true });
    const { prisma } = makePrisma([
      { id: 'bad', sentById: 'u1' },
      { id: 'good', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 1,
      skippedNoActor: 0,
      failed: 1,
    });
    expect(logWarn).toHaveBeenCalled();
  });

  it('исключение на одной бумаге тоже не останавливает остальные', async () => {
    // Самый вероятный случай — удалённый отправитель: журнал ссылается на
    // настоящего пользователя, а отметка в документе — просто строка.
    setDocumentStatus
      .mockRejectedValueOnce(new Error('нет такого пользователя'))
      .mockResolvedValueOnce({ ok: true });
    const { prisma } = makePrisma([
      { id: 'gone', sentById: 'u-deleted' },
      { id: 'good', sentById: 'u2' },
    ]);
    expect(await runExpireProposals(prisma, NOW)).toEqual({
      expired: 1,
      skippedNoActor: 0,
      failed: 1,
    });
    expect(logError).toHaveBeenCalled();
  });

  it('итог захода попадает в журнал: ночную задачу читают по логам', async () => {
    const { prisma } = makePrisma([{ id: 'd1', sentById: 'u1' }]);
    await runExpireProposals(prisma, NOW);
    expect(logInfo).toHaveBeenCalledWith(
      expect.stringContaining('expire-proposals'),
      expect.objectContaining({ expired: 1, found: 1 })
    );
  });
});
