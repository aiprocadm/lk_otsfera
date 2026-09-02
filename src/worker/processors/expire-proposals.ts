import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { expiredProposalsWhere } from '@/lib/documents/proposalExpiry';
import { setDocumentStatus } from '@/lib/services/documents/status';
import { log } from '@/lib/logging';

/**
 * `У-164` (этап 7) — ежедневное истечение срока коммерческих предложений.
 *
 * **Почему по одному, а не одним `updateMany`.** Соблазн очевиден: строк
 * может быть много, а обновление у всех одинаковое. Но статус документа
 * меняется ТОЛЬКО через `setDocumentStatus` — она проверяет матрицу переходов
 * по каждому документу и по каждому же пишет строку в журнал. Одним
 * `updateMany` в журнале не осталось бы ни записи, и «кто и когда истёк
 * этот документ» выяснить было бы нечем. Запрет держит страж
 * `security.document-status.guardrail`, и заведён он был именно ради этой
 * задачи.
 *
 * **Почему актёр — отправитель.** `AuditLog.userId` обязателен и ссылается на
 * настоящего пользователя; системного пользователя в проекте нет. Ближайший
 * честный ответ на вопрос «по чьей воле это произошло» — тот, кто отправил
 * предложение клиенту: срок пошёл с его действия. Заводить системного
 * пользователя ради одной задачи — отдельная работа (спека §3.3).
 *
 * **Почему нет отдельного поля-«захвата».** У дневной задачи по срокам оно не
 * нужно: сама смена статуса и есть захват — выборка берёт только `sent`, а
 * обработанная строка становится `expired` и в следующий заход не попадёт.
 * Повтор после сбоя безопасен по построению.
 */

/**
 * Сколько предложений истекает за один заход. Остаток добьётся следующей
 * ночью: предложений со сроком в один день столько не бывает, а ограничение
 * не даёт одной задаче держать соединение часами.
 */
const BATCH_LIMIT = 500;

export type ExpireProposalsResult = {
  /** Сколько бумаг переведено в «истёк срок». */
  expired: number;
  /** Пропущено: нет отправителя, значит некому приписать действие. */
  skippedNoActor: number;
  /** Пропущено из-за отказа двери статусов или ошибки записи. */
  failed: number;
};

export async function runExpireProposals(
  prisma: PrismaClient,
  now: Date
): Promise<ExpireProposalsResult> {
  const due = await prisma.document.findMany({
    where: expiredProposalsWhere(now),
    orderBy: { validUntil: 'asc' },
    take: BATCH_LIMIT,
    select: { id: true, sentById: true },
  });

  const result: ExpireProposalsResult = { expired: 0, skippedNoActor: 0, failed: 0 };

  for (const doc of due) {
    if (!doc.sentById) {
      // Отправителя нет — приписать действие некому, а выдумывать автора в
      // журнале хуже, чем оставить бумагу как есть. Такое возможно у
      // документов, приехавших извне; человек переведёт их руками.
      result.skippedNoActor += 1;
      continue;
    }
    /**
     * Сессия собирается вручную: у фоновой задачи её нет и быть не может.
     * Дверь статусов берёт отсюда ТОЛЬКО `sub` — им подписывается запись в
     * журнале. Роль намеренно не выдумываем: проверять права не у кого и
     * незачем (решение принял календарь, а не человек), а фальшивый литерал
     * роли ещё и попал бы в инвентарь стража ролевой модели как настоящий.
     */
    const actor = { sub: doc.sentById } as unknown as SessionPayload;
    try {
      const res = await setDocumentStatus(prisma, actor, { documentId: doc.id, to: 'expired' });
      if (res.ok) {
        result.expired += 1;
        continue;
      }
      // Отказ двери — не повод ронять весь ночной заход: остальные бумаги
      // ждать не должны. Но и молчать нельзя: отказ означает, что выборка и
      // матрица переходов разошлись.
      result.failed += 1;
      log.warn('[worker/expire-proposals] дверь статусов отказала', {
        documentId: doc.id,
        error: res.error,
      });
    } catch (e) {
      // Чаще всего это удалённый пользователь-отправитель: `AuditLog.userId`
      // ссылается на настоящую строку, а `Document.sentById` — нет.
      result.failed += 1;
      log.error('[worker/expire-proposals] не удалось истечь документ', {
        documentId: doc.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  log.info('[worker/expire-proposals] заход завершён', { ...result, found: due.length });
  return result;
}

export async function expireProposalsProcessor(): Promise<ExpireProposalsResult> {
  const { prisma } = await import('@/lib/db/prisma');
  return runExpireProposals(prisma, new Date());
}
