import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { setDocumentStatus } from './status';

/**
 * `У-165` (этап 7) — заказчик отклоняет коммерческое предложение.
 *
 * **Комментарий обязателен, и это не формальность.** Отказ без причины
 * сообщает менеджеру только то, что он и так узнает из статуса. Причина —
 * единственное, ради чего это действие вообще существует: «дорого»,
 * «сроки не подходят» и «выбрали другого» ведут к разным следующим шагам.
 * Поэтому пустая строка — отказ, а не молчаливое сохранение пустоты.
 *
 * **Пишется в свои поля, а не в `cancelReason`.** «Аннулировал сотрудник» и
 * «клиент сказал нет» — разные события: первое означает нашу ошибку в бумаге,
 * второе — ответ по существу. Свалив их в одно поле, мы потеряли бы
 * возможность отличить одно от другого в отчётности.
 *
 * Отклонять может ТОЛЬКО заказчик. У сотрудника для «клиент отказался» есть
 * аннулирование, и смешивать их нельзя: иначе в отчёте о причинах отказов
 * окажутся наши собственные опечатки.
 */

/** Причина отказа: без неё действие теряет смысл. Предел — как у аннулирования. */
const MAX_REASON = 2000;

export type RejectProposalResult =
  | { ok: true }
  | {
      ok: false;
      error:
        'forbidden' | 'not_found' | 'not_a_proposal' | 'reason_required' | 'invalid_transition';
    };

export async function rejectProposal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { documentId: string; reason: string }
): Promise<RejectProposalResult> {
  // Дверь заказчика по построению: у сотрудника своё действие (аннулирование).
  if (session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const reason = args.reason.trim().slice(0, MAX_REASON);
  if (!reason) return { ok: false, error: 'reason_required' };

  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    select: {
      id: true,
      // Тип и состояние — требование стража чтения: без них гейт ходил бы в
      // базу второй раз.
      type: true,
      status: true,
      orderId: true,
      companyId: true,
      counterpartyType: true,
      counterpartyId: true,
      order: { select: { companyId: true } },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  // Тот же предикат, что у скачивания (§4): отказ и отсутствие неотличимы.
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };
  if (doc.type !== 'commercial_proposal') return { ok: false, error: 'not_a_proposal' };

  const changed = await setDocumentStatus(prisma, session, {
    documentId: doc.id,
    to: 'rejected',
    reason,
  });
  if (!changed.ok) {
    // Матрица уже сказала, что переход невозможен: например, предложение
    // приняли раньше или его аннулировали. Не переспрашиваем.
    return { ok: false, error: changed.error === 'not_found' ? 'not_found' : 'invalid_transition' };
  }

  /**
   * Письма менеджеру ЗДЕСЬ НЕТ, и это решение, а не забывчивость.
   *
   * Подходящего события в реестре уведомлений не существует: ближайшее
   * («документ принят заказчиком») сказало бы менеджеру прямо противоположное
   * тому, что произошло. Заводить новое событие ТЗ не просит, а врать в письме
   * хуже, чем промолчать: отказ и его причина видны в карточке предложения и
   * в списке на карточке клиента.
   */
  return { ok: true };
}
