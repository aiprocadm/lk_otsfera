import type { Job } from 'bullmq';
import { prisma } from '@/lib/db/prisma';
import { primeIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { log } from '@/lib/logging';
import { reconcileDebts, type ReconcileDebtsResult } from '@/lib/services/oneCSync/reconcileDebts';

/**
 * `У-257`: ночная сверка дебиторки с 1С.
 *
 * Процессор ничего не решает сам: зовёт сверку и отдаёт её итог в задачу.
 * Запись в историю обмена делает сама сверка — один раз и одинаково, из
 * очереди её запустили или кнопкой «Повторить сверку».
 *
 * **Задача не падает, когда метод не подключён.** `GET /api/debts` ожидает
 * реализации на стороне 1С; пока его нет, сверка возвращает `not_implemented`,
 * и это нормальный исход, а не сбой: падение отправило бы задачу в повтор
 * пять раз подряд и засыпало бы дежурного письмами.
 */
export async function syncReconcileDebtsProcessor(job: Job): Promise<ReconcileDebtsResult> {
  void job;
  // Пороги и параметры обмена правятся из интерфейса (`У-125`): воркер обязан
  // взять свежий снапшот, иначе будет работать по значениям с момента старта.
  await primeIntegrationSettingsCache(prisma);

  const result = await reconcileDebts(prisma);
  if (!result.ok) {
    log.warn('[worker/sync-reconcile-debts] сверка не выполнена', {
      reason: result.error,
      message: result.message,
    });
    return result;
  }

  log.info('[worker/sync-reconcile-debts] сверка выполнена', {
    checked: result.checked,
    mismatches: result.mismatches.length,
    unmatched: result.unmatched,
  });
  return result;
}
