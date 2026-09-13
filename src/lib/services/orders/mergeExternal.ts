import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { isLeaderSameCompany } from '@/lib/auth/managerPolicy';

/**
 * «Это тот же заказ, что …» — объединение заказа из Битрикс24 с заказом 1С
 * (`У-197`, `В-2-4`, спека §3.5).
 *
 * Миграция заводит заказ-историю только тогда, когда похожего заказа 1С не
 * нашлось сама. Человек видит больше: он знает, что «Обучение, март» из
 * Битрикса и счёт из 1С — одна и та же работа. Эта функция переносит на заказ
 * 1С всё, что миграция привязала к своему заказу, и удаляет пустой дубль.
 *
 * Удаляется ТОЛЬКО заказ Битрикса и только пустой: если на нём успели
 * появиться деньги, строки, переписка или загрузки — объединение отказывает.
 * Терять их при слиянии нельзя, а переносить вслепую тем более: у заказа 1С
 * своя бухгалтерия, и чужие строки в ней хуже дубля.
 */
export type MergeExternalError =
  | 'forbidden'
  | 'not_found'
  | 'not_bitrix_order'
  | 'same_order'
  | 'other_organization'
  | 'target_is_bitrix'
  | 'has_payments'
  | 'has_lines'
  | 'has_activity'
  | 'target_has_deal';

export type MergeExternalResult =
  | { ok: true; moved: { documents: number; tasks: number; notes: number; deal: boolean } }
  | { ok: false; error: MergeExternalError };

const ORDER_SELECT = {
  id: true,
  companyId: true,
  organizationId: true,
  externalId: true,
  orderNumber: true,
  title: true,
  primaryContactId: true,
} as const;

/** Заказ Битрикса опознаётся по ключу: `bitrixId` у заказов нет (`У-190`). */
export function isBitrixOrder(order: { externalId: string | null }): boolean {
  return Boolean(order.externalId?.startsWith('bitrix:'));
}

function canMerge(session: SessionPayload, companyId: string): boolean {
  return session.role === 'admin' || isLeaderSameCompany(session, companyId);
}

export async function mergeExternalOrderInto(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { sourceOrderId: string; targetOrderId: string }
): Promise<MergeExternalResult> {
  if (args.sourceOrderId === args.targetOrderId) return { ok: false, error: 'same_order' };

  const [source, target] = await Promise.all([
    prisma.order.findUnique({ where: { id: args.sourceOrderId }, select: ORDER_SELECT }),
    prisma.order.findUnique({ where: { id: args.targetOrderId }, select: ORDER_SELECT }),
  ]);
  if (!source || !target) return { ok: false, error: 'not_found' };
  // Порядок проверок важен: для сотрудника чужой компании заказа не существует
  // вовсе («не найден»), и только для своего решается вопрос прав («нельзя»).
  // Администратор видит все компании — это Model A, а не исключение.
  if (session.role !== 'admin' && source.companyId !== session.companyId) {
    return { ok: false, error: 'not_found' };
  }
  if (!canMerge(session, source.companyId)) return { ok: false, error: 'forbidden' };
  if (target.companyId !== source.companyId) return { ok: false, error: 'not_found' };

  if (!isBitrixOrder(source)) return { ok: false, error: 'not_bitrix_order' };
  if (isBitrixOrder(target)) return { ok: false, error: 'target_is_bitrix' };
  if (target.organizationId !== source.organizationId) {
    return { ok: false, error: 'other_organization' };
  }

  const blocker = await findBlocker(prisma, source.id, target.id);
  if (blocker) return { ok: false, error: blocker };

  const moved = await prisma.$transaction(async (tx) => {
    const [documents, tasks, notes, deal, events] = await Promise.all([
      tx.document.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } }),
      tx.task.updateMany({
        where: { linkedOrderId: source.id },
        data: { linkedOrderId: target.id },
      }),
      tx.dealNote.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } }),
      tx.deal.updateMany({ where: { orderId: source.id }, data: { orderId: target.id } }),
      tx.calendarEvent.updateMany({
        where: { linkedOrderId: source.id },
        data: { linkedOrderId: target.id },
      }),
      // Лид, из которого вырос заказ Битрикса, должен указывать на настоящий.
      tx.lead.updateMany({
        where: { promotedOrderId: source.id },
        data: { promotedOrderId: target.id },
      }),
    ]);

    // Контакт заказа переносим, только если у цели его нет: живое значение
    // в заказе 1С — решение менеджера, и затирать его нечем.
    if (source.primaryContactId && !target.primaryContactId) {
      await tx.order.update({
        where: { id: target.id },
        data: { primaryContactId: source.primaryContactId },
      });
    }

    await tx.order.delete({ where: { id: source.id } });

    await recordAudit(tx, {
      userId: session.sub,
      action: 'order_merged_into',
      entity: 'order',
      entityId: target.id,
      before: {
        sourceOrderId: source.id,
        sourceExternalId: source.externalId,
        sourceTitle: source.title,
      },
      after: {
        targetOrderId: target.id,
        targetNumber: target.orderNumber ?? target.externalId,
        moved: {
          documents: documents.count,
          tasks: tasks.count,
          notes: notes.count,
          deal: deal.count > 0,
          events: events.count,
        },
      },
    });

    return {
      documents: documents.count,
      tasks: tasks.count,
      notes: notes.count,
      deal: deal.count > 0,
    };
  });

  return { ok: true, moved };
}

/**
 * Что мешает объединению. Проверяем ДО транзакции и по каждой связи отдельно:
 * человеку нужна причина отказа, а не «не удалось удалить заказ».
 *
 * Комментарии, загрузки, треды и позиции держат заказ жёстким внешним ключом —
 * на заказе миграции их не бывает, но если появились, значит заказом уже
 * пользовались как живым, и молча удалять его нельзя.
 */
async function findBlocker(
  prisma: PrismaClient,
  sourceId: string,
  targetId: string
): Promise<MergeExternalError | null> {
  const [payments, lines, items, comments, uploads, threads, statements, targetDeal] =
    await Promise.all([
      prisma.payment.count({ where: { orderId: sourceId } }),
      prisma.orderLine.count({ where: { orderId: sourceId } }),
      prisma.orderItem.count({ where: { orderId: sourceId } }),
      prisma.comment.count({ where: { orderId: sourceId } }),
      prisma.upload.count({ where: { orderId: sourceId } }),
      prisma.orderThread.count({ where: { orderId: sourceId } }),
      prisma.commissionStatementItem.count({ where: { orderId: sourceId } }),
      prisma.deal.count({ where: { orderId: targetId } }),
    ]);

  if (payments > 0) return 'has_payments';
  if (lines > 0 || items > 0) return 'has_lines';
  if (comments > 0 || uploads > 0 || threads > 0 || statements > 0) return 'has_activity';
  // У заказа один выигранный сделочный «родитель» (`Deal.orderId @unique`).
  if (targetDeal > 0) return 'target_has_deal';
  return null;
}

export type MergeTarget = {
  id: string;
  label: string;
  totalAmount: string;
  closedAt: Date | null;
};

const TARGETS_CAP = 20;

/**
 * Кандидаты для объединения: заказы 1С той же организации. Заказы Битрикса и
 * заказы без внешнего ключа в список не попадают — объединять историю с
 * историей незачем, а ручной заказ кабинета живёт своей жизнью.
 */
export async function listMergeTargets(
  prisma: PrismaClient,
  session: SessionPayload,
  sourceOrderId: string
): Promise<{ ok: true; targets: MergeTarget[] } | { ok: false; error: MergeExternalError }> {
  const source = await prisma.order.findUnique({
    where: { id: sourceOrderId },
    select: ORDER_SELECT,
  });
  if (!source) return { ok: false, error: 'not_found' };
  if (session.role !== 'admin' && source.companyId !== session.companyId) {
    return { ok: false, error: 'not_found' };
  }
  if (!canMerge(session, source.companyId)) return { ok: false, error: 'forbidden' };
  if (!isBitrixOrder(source)) return { ok: false, error: 'not_bitrix_order' };

  const rows = await prisma.order.findMany({
    where: {
      companyId: source.companyId,
      organizationId: source.organizationId,
      id: { not: source.id },
      externalId: { not: null },
      NOT: { externalId: { startsWith: 'bitrix:' } },
    },
    select: {
      id: true,
      orderNumber: true,
      externalId: true,
      title: true,
      totalAmount: true,
      closedAt: true,
      completedAt: true,
    },
    orderBy: [{ closedAt: 'desc' }, { id: 'desc' }],
    take: TARGETS_CAP,
  });

  return {
    ok: true,
    targets: rows.map((row) => ({
      id: row.id,
      // `externalId` у кандидата есть всегда — так их отбирает запрос выше.
      label: `${row.orderNumber ?? (row.externalId as string)} — ${row.title}`,
      totalAmount: String(row.totalAmount),
      closedAt: row.closedAt ?? row.completedAt,
    })),
  };
}
