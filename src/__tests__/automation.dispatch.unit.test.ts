import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';

const { isFeatureEnabled } = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@/lib/featureFlags', () => ({ isFeatureEnabled }));

const { add, getQueue } = vi.hoisted(() => {
  const add = vi.fn();
  return { add, getQueue: vi.fn(() => ({ add })) };
});
vi.mock('@/lib/jobs/queues', () => ({ getQueue }));

const { logError, logWarn } = vi.hoisted(() => ({ logError: vi.fn(), logWarn: vi.fn() }));
vi.mock('@/lib/logging', () => ({ log: { error: logError, warn: logWarn } }));

import { emitAutomationEvent, automationJobId } from '@/lib/automation/dispatch';

/**
 * Диспетчер событий правил (`У-223`, этап 4 PR-3).
 *
 * Проверяется то, что ломается тихо:
 *  - **граница компании**: правила ищутся только в своей компании;
 *  - **флаг**: выключенный робот не трогает даже базу;
 *  - **зацикливание**: событие от самого правила отбрасывается;
 *  - **fail-open**: падение правил не отменяет бизнес-операцию;
 *  - **идемпотентность**: у всех правил одного события ОДИН `eventId`, а `jobId`
 *    детерминирован.
 */

const findMany = vi.fn();
const prisma = { automationRule: { findMany } } as unknown as PrismaClient;

beforeEach(() => {
  vi.clearAllMocks();
  isFeatureEnabled.mockReturnValue(true);
  findMany.mockResolvedValue([{ id: 'r1', conditions: {} }]);
});

describe('emitAutomationEvent — когда НЕ срабатывает', () => {
  it('флаг выключен → база не спрашивается вовсе', async () => {
    isFeatureEnabled.mockReturnValue(false);
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: 'co-1',
        payload: {},
      })
    ).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('событие ПОРОЖДЕНО ПРАВИЛОМ → отбрасывается раньше всего (третий заслон `Р-Б-6`)', async () => {
    const res = await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: {},
      source: 'automation',
    });
    expect(res).toBe(0);
    expect(isFeatureEnabled).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('без компании → правил нет, спрашивать нечего', async () => {
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: null,
        payload: {},
      })
    ).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('подходящих правил нет → очередь не трогаем', async () => {
    findMany.mockResolvedValue([]);
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: 'co-1',
        payload: {},
      })
    ).toBe(0);
    expect(add).not.toHaveBeenCalled();
  });

  it('ПАДЕНИЕ БАЗЫ не отменяет бизнес-операцию (fail-open §3)', async () => {
    findMany.mockRejectedValue(new Error('база легла'));
    // Ни исключения наружу, ни отказа: смена статуса заказа уже сохранена.
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: 'co-1',
        payload: {},
      })
    ).toBe(0);
    expect(logError).toHaveBeenCalled();
  });

  it('база бросила НЕ-Error — в журнал уходит читаемая строка, а не «[object Object]»', async () => {
    // Драйверы и обёртки иногда бросают строку или объект. Расследовать сбой
    // по записи «[object Object]» невозможно, поэтому текст сводится к строке.
    findMany.mockRejectedValue('соединение закрыто');
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: 'co-1',
        payload: {},
      })
    ).toBe(0);
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: 'соединение закрыто' })
    );
  });
});

describe('emitAutomationEvent — выборка правил', () => {
  it('ищет ТОЛЬКО активные правила СВОЕЙ компании и СВОЕГО триггера', async () => {
    await emitAutomationEvent(prisma, {
      trigger: 'payment_received',
      companyId: 'co-1',
      payload: {},
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      companyId: 'co-1',
      trigger: 'payment_received',
      isActive: true,
    });
  });

  it('правило с НЕЧИТАЕМЫМИ условиями пропускается, а не срабатывает «на всякий случай»', async () => {
    findMany.mockResolvedValue([{ id: 'r1', conditions: { такогоПоляНет: 1 } }]);
    const res = await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: {},
    });
    expect(res).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalled();
  });

  it('условия NULL в базе означают «без условий», а не «правило сломано»', async () => {
    // Колонка `conditions` допускает NULL: у правила «срабатывать всегда»
    // условий нет вовсе. Разбор `null` схемой объекта провалился бы, и такое
    // правило молча перестало бы работать.
    findMany.mockResolvedValue([{ id: 'r1', conditions: null }]);
    expect(
      await emitAutomationEvent(prisma, {
        trigger: 'order_status_changed',
        companyId: 'co-1',
        payload: { amount: 1 },
      })
    ).toBe(1);
    expect(add).toHaveBeenCalled();
  });

  it('условие не совпало → правило не ставится в очередь', async () => {
    findMany.mockResolvedValue([{ id: 'r1', conditions: { amountGte: 100000 } }]);
    const res = await emitAutomationEvent(prisma, {
      trigger: 'payment_received',
      companyId: 'co-1',
      payload: { amount: 5000 },
    });
    expect(res).toBe(0);
  });

  it('условие совпало → правило ставится', async () => {
    findMany.mockResolvedValue([{ id: 'r1', conditions: { amountGte: 1000 } }]);
    const res = await emitAutomationEvent(prisma, {
      trigger: 'payment_received',
      companyId: 'co-1',
      payload: { amount: 5000 },
    });
    expect(res).toBe(1);
  });
});

describe('emitAutomationEvent — идемпотентность', () => {
  it('у ВСЕХ правил одного события один и тот же eventId', async () => {
    findMany.mockResolvedValue([
      { id: 'r1', conditions: {} },
      { id: 'r2', conditions: {} },
    ]);
    await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: {},
    });
    const ids = add.mock.calls.map((c) => (c[1] as { eventId: string }).eventId);
    expect(new Set(ids).size).toBe(1);
  });

  it('jobId детерминирован — повторная постановка того же события не удваивает работу', async () => {
    await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: {},
    });
    const [, job, opts] = add.mock.calls[0] as [
      string,
      { ruleId: string; eventId: string },
      { jobId: string },
    ];
    expect(opts.jobId).toBe(automationJobId(job.ruleId, job.eventId));
    expect(opts.jobId).toContain('auto_r1_');
  });

  it('данные события доезжают до очереди целиком', async () => {
    await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: { orderId: 'ord1', responsibleManagerId: 'm1' },
    });
    expect(add.mock.calls[0][1]).toMatchObject({
      ruleId: 'r1',
      companyId: 'co-1',
      payload: { orderId: 'ord1', responsibleManagerId: 'm1' },
    });
  });
});

/**
 * Очередь тоже падает. У одного события бывает несколько правил, и падение на
 * первом не имеет права лишить срабатывания остальные — поэтому у постановки в
 * очередь своя обёртка, а не только внешняя (§3, graceful degrade).
 */
describe('очередь недоступна', () => {
  it('правило не поставлено, но событие не падает и пишется в журнал', async () => {
    isFeatureEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([{ id: 'r1', conditions: {} }]);
    add.mockRejectedValue(new Error('Redis лёг'));

    const queued = await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: { orderId: 'ord1' },
    });

    expect(queued).toBe(0);
    expect(logError).toHaveBeenCalledWith(
      '[automation/dispatch] не удалось поставить правило в очередь',
      expect.objectContaining({ ruleId: 'r1', error: 'Redis лёг' })
    );
  });

  it('не-Error в сбое очереди тоже читается строкой', async () => {
    isFeatureEnabled.mockReturnValue(true);
    findMany.mockResolvedValue([{ id: 'r1', conditions: {} }]);
    add.mockRejectedValue('очередь закрыта');
    await emitAutomationEvent(prisma, {
      trigger: 'order_status_changed',
      companyId: 'co-1',
      payload: { orderId: 'ord1' },
    });
    expect(logError.mock.calls[0][1].error).toBe('очередь закрыта');
  });
});
