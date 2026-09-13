import type { OrderPlan } from '../mapping/orders';
import { snapshot, writeJournal, type ApplyContext, type Tx, type WriteOutcome } from './journal';

/**
 * Заказ из выигранной сделки (`У-197`, спека §3.5).
 *
 * Два исхода: нашёлся похожий заказ 1С — связываем (действие `linked`, откат
 * просто снимет связь); не нашёлся — заводим заказ-историю. Такой заказ закрыт
 * и выполнен, но БЕЗ денег: оплату считает 1С, и придумывать её за неё нельзя.
 *
 * Историю статуса пишем сразу: заказ без единой записи «когда закрылся»
 * выглядел бы так, будто он такой с рождения.
 */
export async function writeWonDealOrder(
  tx: Tx,
  ctx: ApplyContext,
  plan: OrderPlan,
  args: { dealId: string; bitrixDealId: string }
): Promise<WriteOutcome | null> {
  if (plan.action === 'link') {
    // Сделка уже может быть привязана к другому заказу — тогда не трогаем:
    // связь «сделка ↔ заказ» одна, и живая важнее перенесённой.
    const linked = await tx.deal.updateMany({
      where: { id: args.dealId, orderId: null },
      data: { orderId: plan.orderId },
    });
    if (linked.count === 0) return null;
    await writeJournal(tx, ctx, {
      entity: 'order',
      entityId: plan.orderId,
      bitrixId: args.bitrixDealId,
      action: 'linked',
      before: { dealId: args.dealId, orderId: null },
      after: { dealId: args.dealId, orderId: plan.orderId },
    });
    return { entityId: plan.orderId, action: 'linked', keptManual: [] };
  }

  if (plan.action !== 'create') return null;

  // Сделка уже привязана к другому заказу — значит, заказ-историю заводить
  // незачем: он повис бы ни на чём, и ни сводка, ни журнал об этом не сказали
  // бы. Связь одна, и живая важнее перенесённой.
  const free = await tx.deal.count({ where: { id: args.dealId, orderId: null } });
  if (free === 0) return null;

  const d = plan.data;
  const created = await tx.order.create({
    data: {
      externalId: d.externalId,
      title: d.title,
      companyId: d.companyId,
      organizationId: d.organizationId,
      managerId: d.managerId,
      totalAmount: d.totalAmount,
      statusId: d.statusId,
      executionStatus: d.executionStatus,
      financialStatus: d.financialStatus,
      closedAt: d.closedAt,
      completedAt: d.completedAt,
    },
    select: { id: true },
  });

  if (d.statusId) {
    await tx.orderStatusChange.create({
      data: {
        orderId: created.id,
        fromId: null,
        toId: d.statusId,
        // Автор — не человек: заказ приехал из Битрикса, а не решением менеджера.
        userId: null,
        reason: 'Перенесено из Битрикс24',
      },
    });
  }

  await tx.deal.updateMany({
    where: { id: args.dealId, orderId: null },
    data: { orderId: created.id },
  });

  await writeJournal(tx, ctx, {
    entity: 'order',
    entityId: created.id,
    bitrixId: args.bitrixDealId,
    action: 'created',
    after: snapshot({
      externalId: d.externalId,
      title: d.title,
      totalAmount: d.totalAmount,
      closedAt: d.closedAt,
    }),
  });
  return { entityId: created.id, action: 'created', keptManual: [] };
}
