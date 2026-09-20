import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';

/**
 * Ночная сверка дебиторки (`У-257`) — обёртка задачи.
 *
 * Главное обещание: **«метод не подключён» — это не сбой**. `GET /api/debts`
 * ждёт реализации на стороне 1С, и пока её нет, сверка честно отвечает
 * `not_implemented`. Урони задача исключение — очередь повторила бы её пять
 * раз подряд и завалила бы дежурного письмами о поломке, которой нет.
 *
 * Второе: **пороги и параметры обмена читаются свежими** на каждый заход.
 * Воркер живёт неделями; возьми он снапшот один раз при старте, правки из
 * интерфейса (`У-125`) не доехали бы до него вовсе.
 */
const mocks = vi.hoisted(() => ({
  reconcileDebts: vi.fn(),
  primeIntegrationSettingsCache: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: { __brand: 'живая база' } }));
vi.mock('@/lib/config/integrationSettingsCache', () => ({
  primeIntegrationSettingsCache: mocks.primeIntegrationSettingsCache,
}));
vi.mock('@/lib/services/oneCSync/reconcileDebts', () => ({ reconcileDebts: mocks.reconcileDebts }));
vi.mock('@/lib/logging', () => ({
  log: { warn: mocks.logWarn, info: mocks.logInfo, error: vi.fn() },
}));

import { syncReconcileDebtsProcessor } from '@/worker/processors/sync-reconcile-debts';

const JOB = {} as Job;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.primeIntegrationSettingsCache.mockResolvedValue(undefined);
});

describe('syncReconcileDebtsProcessor', () => {
  it('удачная сверка отдаёт итог и пишет его в журнал', async () => {
    const ok = { ok: true, checked: 120, mismatches: [{ organizationId: 'o1' }], unmatched: 2 };
    mocks.reconcileDebts.mockResolvedValue(ok);

    const res = await syncReconcileDebtsProcessor(JOB);

    expect(res).toBe(ok);
    expect(mocks.logInfo).toHaveBeenCalledWith('[worker/sync-reconcile-debts] сверка выполнена', {
      checked: 120,
      mismatches: 1,
      unmatched: 2,
    });
  });

  it('метод не подключён — предупреждение, а не падение', async () => {
    const fail = { ok: false, error: 'not_implemented', message: 'метода нет' };
    mocks.reconcileDebts.mockResolvedValue(fail);

    const res = await syncReconcileDebtsProcessor(JOB);

    // Итог возвращается как есть: очередь увидит успешное завершение и не
    // станет повторять задачу пять раз.
    expect(res).toBe(fail);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      '[worker/sync-reconcile-debts] сверка не выполнена',
      { reason: 'not_implemented', message: 'метода нет' }
    );
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });

  it('свежие настройки берутся ДО сверки, а не после', async () => {
    const order: string[] = [];
    mocks.primeIntegrationSettingsCache.mockImplementation(async () => {
      order.push('настройки');
    });
    mocks.reconcileDebts.mockImplementation(async () => {
      order.push('сверка');
      return { ok: true, checked: 0, mismatches: [], unmatched: 0 };
    });

    await syncReconcileDebtsProcessor(JOB);

    expect(order).toEqual(['настройки', 'сверка']);
    // Сверка получает ту же живую базу, что и снапшот настроек.
    expect(mocks.reconcileDebts.mock.calls[0]?.[0]).toBe(
      mocks.primeIntegrationSettingsCache.mock.calls[0]?.[0]
    );
  });
});
