import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { notifyManagers } from '@/lib/notifications';
import { computeLineTotals, sumOrderTotals } from '@/lib/services/orders/lineMath';
import { getInitialStatusId } from '@/lib/services/orderStatuses/definitions';
import { setDocumentStatus } from './status';

/**
 * `У-164` (этап 7) — принятие коммерческого предложения.
 *
 * **Почему отдельный сервис, а не ветка в `accept.ts`.** Приёмка акта и
 * принятие предложения — разные события, а не два вида одного:
 *
 * - у них разные АКТЁРЫ. `accept.ts` — дверь заказчика по построению (первая
 *   же строка отсекает всех остальных). Предложение чаще принимают со слов
 *   клиента: «по телефону согласовали» — значит нажимает сотрудник;
 * - разные ПОСЛЕДСТВИЯ. Приёмка акта — смена одного поля. Принятие
 *   предложения заводит ЗАКАЗ и переносит в него состав;
 * - разные ОТКАЗЫ. У предложения свои: «нет организации», «состав заказа уже
 *   набран». В общем типе они были бы мёртвыми ветками для акта.
 *
 * **Принятие НЕ означает «сделка выиграна».** Кнопка «Выиграна» остаётся
 * ручной: выигрыш — решение менеджера о переговорах, а не следствие согласия
 * с ценой. Сделке ставится ровно одно поле — ссылка на заказ.
 */

export type AcceptProposalResult =
  | {
      ok: true;
      orderId: string;
      /** `false` — заказ у сделки уже был, использовали его. */
      orderCreated: boolean;
      /** Сколько строк предложения перенесено в заказ. */
      linesTransferred: number;
      /**
       * `true` — состав заказа НЕ тронут, потому что в нём уже были строки.
       * Это не ошибка: предложение принято, а перезапись чужого состава
       * стёрла бы работу менеджера. Экран обязан сказать об этом человеку.
       */
      keptExistingLines: boolean;
    }
  | {
      ok: false;
      error:
        | 'forbidden'
        | 'not_found'
        | 'not_a_proposal'
        | 'invalid_transition'
        | 'organization_required'
        /** Заказ приехал из 1С: его состав ведёт учётная система, не мы. */
        | 'order_from_1c';
    }
  | {
      /**
       * Заказ создан, а перевести предложение в «принято» не удалось.
       *
       * Не откатываем: заказ со строками уже полезен, а откат ради красоты
       * состояния выбросил бы работу. Тот же приём, что у создания
       * организации из очереди («не откатывать шаг 1, вернуть его результат
       * внутри ошибки и назвать следующую кнопку»).
       */
      ok: false;
      error: 'status_failed';
      orderId: string;
    };

export async function acceptProposal(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { documentId: string }
): Promise<AcceptProposalResult> {
  const doc = await prisma.document.findUnique({
    where: { id: args.documentId },
    select: {
      id: true,
      // Тип и состояние — требование стража чтения: без них гейт ходил бы в
      // базу второй раз.
      type: true,
      status: true,
      number: true,
      companyId: true,
      orderId: true,
      counterpartyType: true,
      counterpartyId: true,
      dealId: true,
      sentById: true,
      uploadedById: true,
      order: { select: { companyId: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          quantity: true,
          unit: true,
          unitPrice: true,
          discountPercent: true,
          vatRate: true,
          vatIncluded: true,
          sortOrder: true,
        },
      },
    },
  });
  if (!doc) return { ok: false, error: 'not_found' };
  // Тот же предикат, что у скачивания (§4): отказ и отсутствие неотличимы.
  if (!(await canReadDocument(session, doc))) return { ok: false, error: 'not_found' };
  if (doc.type !== 'commercial_proposal') return { ok: false, error: 'not_a_proposal' };

  /**
   * Заказ создаётся ДЛЯ ОРГАНИЗАЦИИ, а у заказа она обязательна. Предложение,
   * висящее на лиде, принять физически нечем — сначала клиента заводят
   * организацией (для этого есть отдельное действие), и вместе с ней переезжает
   * само предложение.
   */
  if (doc.counterpartyType !== 'organization' || !doc.counterpartyId)
    return { ok: false, error: 'organization_required' };
  const organizationId = doc.counterpartyId;

  /**
   * Сделка берётся ТОЛЬКО из самого документа. Искать её по организации
   * нельзя: угаданная сделка привязала бы заказ к чужим переговорам. Связь
   * уже сверена сервером при выпуске.
   */
  const deal = doc.dealId
    ? await prisma.deal.findUnique({
        where: { id: doc.dealId },
        select: { id: true, companyId: true, organizationId: true, managerId: true, orderId: true },
      })
    : null;

  // Существующий заказ сделки — сценарии 3 и 4 требования.
  const existingOrder = deal?.orderId
    ? await prisma.order.findUnique({
        where: { id: deal.orderId },
        select: { id: true, externalId: true, _count: { select: { lines: true } } },
      })
    : null;
  // Заказ из 1С: состав ведёт учётная система, и дописывать в него наши строки
  // значит спорить с ней при следующей выгрузке.
  if (existingOrder?.externalId) return { ok: false, error: 'order_from_1c' };

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { partnerId: true },
  });

  const keptExistingLines = (existingOrder?._count.lines ?? 0) > 0;
  /**
   * Строки заказа — строками, а не пересчётом «на глаз»: суммы считает тот же
   * помощник, что и везде, поэтому заказ и бумага сходятся до копейки.
   */
  const mathInput = doc.lines.map((l) => ({
    quantity: l.quantity.toString(),
    unitPrice: l.unitPrice.toString(),
    discountPercent: l.discountPercent?.toString() ?? null,
    vatRate: l.vatRate?.toString() ?? null,
    // Признак «цена с НДС» переносится как есть: восстановить его из суммы
    // налога нельзя — при ставке 0 и при «не облагается» результат
    // неразличим, и сумма заказа разошлась бы с суммой предложения.
    vatIncluded: l.vatIncluded,
  }));
  const lineData = doc.lines.map((l, i) => ({
    title: l.title,
    quantity: l.quantity.toString(),
    unit: l.unit,
    unitPrice: l.unitPrice.toString(),
    discountPercent: l.discountPercent?.toString() ?? null,
    vatRate: l.vatRate?.toString() ?? null,
    vatIncluded: l.vatIncluded,
    amount: computeLineTotals(mathInput[i]!).amount,
    sortOrder: l.sortOrder,
  }));
  const totals = sumOrderTotals(mathInput);

  const initialStatusId = existingOrder ? null : await getInitialStatusId(prisma);

  const { orderId, orderCreated } = await prisma.$transaction(async (tx) => {
    if (existingOrder) {
      if (!keptExistingLines && lineData.length > 0) {
        await tx.orderLine.createMany({
          data: lineData.map((l) => ({ ...l, orderId: existingOrder.id })),
        });
        await tx.order.update({
          where: { id: existingOrder.id },
          data: { totalAmount: totals.gross, totalAmountIsManual: false },
        });
      }
      return { orderId: existingOrder.id, orderCreated: false };
    }

    const order = await tx.order.create({
      data: {
        statusId: initialStatusId,
        title: doc.number ? `Заказ по КП ${doc.number}` : 'Заказ по коммерческому предложению',
        // Компания берётся у ДОКУМЕНТА: у организации это поле необязательное,
        // и заказ мог бы остаться без компании-исполнителя.
        companyId: doc.companyId,
        organizationId,
        // Партнёр — из карточки организации: забудь его, и посредник молча
        // потеряет вознаграждение по этому заказу.
        partnerId: organization?.partnerId ?? null,
        /**
         * Ответственный — менеджер сделки, иначе тот, кто отправил или выпустил
         * предложение. НЕ инициатор действия: принять предложение может сам
         * заказчик, и его пользователь стал бы менеджером заказа.
         */
        managerId: deal?.managerId ?? doc.sentById ?? doc.uploadedById ?? null,
        totalAmount: totals.gross,
        executionStatus: 'pending',
        financialStatus: 'not_billed',
        ...(lineData.length > 0 ? { lines: { create: lineData } } : {}),
      },
      select: { id: true },
    });

    // Сделке ставится РОВНО ОДНО поле. Выигрыш — отдельное решение менеджера,
    // и `Deal.orderId` уникален: привязка в той же транзакции даёт бесплатную
    // защиту от двойного нажатия — второй заказ откатится вместе с ней.
    if (deal && deal.orderId === null) {
      await tx.deal.update({ where: { id: deal.id }, data: { orderId: order.id } });
    }
    return { orderId: order.id, orderCreated: true };
  });

  /**
   * Статус меняется ПОСЛЕ заказа и через единственную дверь. Порядок выбран
   * сознательно: заказ со строками полезен сам по себе, а «принято» без
   * заказа выглядело бы выполненным обещанием, которого нет.
   */
  const changed = await setDocumentStatus(prisma, session, {
    documentId: doc.id,
    to: 'accepted',
  });
  if (!changed.ok) {
    if (orderCreated) return { ok: false, error: 'status_failed', orderId };
    return {
      ok: false,
      error: changed.error === 'not_found' ? 'not_found' : 'invalid_transition',
    };
  }

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'proposal_accepted',
    entity: 'document',
    entityId: doc.id,
    after: {
      orderId,
      orderCreated,
      dealId: deal?.id ?? null,
      linesTransferred: keptExistingLines ? 0 : lineData.length,
      keptExistingLines,
    },
  });

  // Уведомление — best-effort и только ПОСЛЕ фиксации транзакции: до неё
  // заказа для отдельного подключения не существует.
  try {
    await notifyManagers(prisma, {
      orderId,
      type: 'document_accepted',
      payload: {
        documentId: doc.id,
        documentType: doc.type,
        documentNumber: doc.number,
        orderNumber: null,
      },
    });
  } catch (err) {
    log.warn('[documents/acceptProposal] notify failed', {
      documentId: doc.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    ok: true,
    orderId,
    orderCreated,
    linesTransferred: keptExistingLines ? 0 : lineData.length,
    keptExistingLines,
  };
}
