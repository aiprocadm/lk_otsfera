import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeOrder, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';
import { notifyOrgUsers } from '@/lib/notifications';
import { evaluateOrderReadiness, type OrderReadiness } from '@/lib/orders/readiness';

/**
 * Этап 12 (Модуль 5, ФТ-5.1/5.2) — готовность заказа и передача результата.
 *
 * Скоуп — обычный `canSeeOrder` (C8): нажать «Передать результат» может **любой
 * менеджер в скоупе заказа** (решение заказчика §6-1), отдельного гейта на
 * руководителя нет.
 *
 * Передача **однократна** (решение §6-3): повторный вызов — no-op, второго
 * уведомления клиент не получает. Довоз результата обсуждается комментариями.
 */

export type DeliveryError = 'not_found' | 'forbidden' | 'not_ready';

/**
 * Поля, которых хватает чистой `evaluateOrderReadiness`. Экспортируется, чтобы
 * «Мой день» (этап 11 PR-2, ФТ-15.3) считал «Готово к передаче» **той же**
 * логикой и на тех же данных, а не своей копией.
 */
export const READINESS_SELECT = {
  id: true,
  orderNumber: true,
  title: true,
  serviceType: true,
  organizationId: true,
  partnerId: true,
  managerId: true,
  companyId: true,
  deliverablesApprovedAt: true,
  resultDeliveredAt: true,
  documents: { select: { direction: true, scanStatus: true } },
  items: {
    select: {
      id: true,
      trainingStatus: true,
      student: { select: { name: true } },
      certificate: { select: { documentId: true } },
    },
  },
} as const;

export type OrderForReadiness = {
  serviceType: 'training' | 'document_development';
  deliverablesApprovedAt: Date | null;
  documents: { direction: string; scanStatus: string }[];
  items: {
    id: string;
    trainingStatus: string;
    student: { name: string };
    certificate: { documentId: string | null } | null;
  }[];
};

/**
 * Этап 12 PR-2 (ФТ-5.3): вердикты ClamAV по сканам удостоверений.
 * `Certificate.documentId` — обычная колонка, а не связь, поэтому статусы
 * дочитываются отдельной выборкой (одной на заказ).
 */
async function loadScanStatuses(
  prisma: PrismaClient,
  orders: OrderForReadiness[]
): Promise<Map<string, string>> {
  const ids = orders
    .flatMap((o) => o.items.map((i) => i.certificate?.documentId))
    .filter((id): id is string => id != null);
  if (ids.length === 0) return new Map();
  const docs = await prisma.document.findMany({
    where: { id: { in: ids } },
    select: { id: true, scanStatus: true },
  });
  return new Map(docs.map((d) => [d.id, d.scanStatus]));
}

/** Приводит выборку Prisma к входу чистой функции готовности. */
function toReadinessInput(order: OrderForReadiness, scanStatuses: Map<string, string>) {
  return {
    serviceType: order.serviceType,
    deliverablesApprovedAt: order.deliverablesApprovedAt,
    documents: order.documents,
    items: order.items.map((i) => ({
      id: i.id,
      trainingStatus: i.trainingStatus as never,
      studentName: i.student.name,
      certificate: i.certificate
        ? {
            documentId: i.certificate.documentId,
            scanStatus: i.certificate.documentId
              ? (scanStatuses.get(i.certificate.documentId) ?? null)
              : null,
          }
        : null,
    })),
  };
}

/**
 * Готовность **пачки** заказов: статусы сканов дочитываются одной выборкой на
 * всю пачку. Единственная точка, где готовность считается из БД — и деталка
 * заказа (ФТ-5.1/5.2), и «Мой день» (ФТ-15.3) ходят сюда.
 */
export async function evaluateReadinessBatch(
  prisma: PrismaClient,
  orders: OrderForReadiness[]
): Promise<OrderReadiness[]> {
  if (orders.length === 0) return [];
  const scanStatuses = await loadScanStatuses(prisma, orders);
  return orders.map((o) => evaluateOrderReadiness(toReadinessInput(o, scanStatuses)));
}

/** ФТ-5.1: блок «Готовность к передаче» на деталке заказа. */
export async function getOrderReadiness(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<
  | { ok: true; readiness: OrderReadiness; deliveredAt: Date | null }
  | { ok: false; error: 'not_found' | 'forbidden' }
> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: READINESS_SELECT });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  const batch = await evaluateReadinessBatch(prisma, [order as OrderForReadiness]);
  // evaluateReadinessBatch — это orders.map(): на один заказ ровно один элемент.
  const readiness = batch[0]!;
  return { ok: true, readiness, deliveredAt: order.resultDeliveredAt };
}

/**
 * ФТ-5.1 (решение §6-2): отметка «работа согласована» для заказов на разработку
 * документов. Ставится руками — из факта загрузки файлов готовность не выводится.
 */
export async function approveDeliverables(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<{ ok: true; approvedAt: Date } | { ok: false; error: 'not_found' | 'forbidden' }> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: READINESS_SELECT });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  // Повторная отметка не сдвигает дату — она фиксирует первое согласование.
  if (order.deliverablesApprovedAt) return { ok: true, approvedAt: order.deliverablesApprovedAt };

  const approvedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { deliverablesApprovedAt: approvedAt, deliverablesApprovedById: session.sub },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'order_deliverables_approved',
      entity: 'order',
      entityId: order.id,
      after: { approvedAt: approvedAt.toISOString() },
    });
  });
  return { ok: true, approvedAt };
}

/**
 * ФТ-5.2: передача результата клиенту. Доступна только при полной готовности;
 * фиксирует `resultDeliveredAt`, шлёт уведомление организации (и партнёру, если
 * заказ его) и пишет аудит. Повтор — no-op.
 */
export async function deliverOrderResult(
  prisma: PrismaClient,
  session: SessionPayload,
  orderId: string
): Promise<
  | { ok: true; deliveredAt: Date; alreadyDelivered: boolean }
  | { ok: false; error: DeliveryError; readiness?: OrderReadiness }
> {
  const teamMode = await getCompanyTeamVisibility(prisma, session.companyId);
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: READINESS_SELECT });
  if (!order) return { ok: false, error: 'not_found' };
  if (!canSeeOrder(session, order, teamMode)) return { ok: false, error: 'forbidden' };

  // Идемпотентность (§6-3): дата ставится один раз, второго уведомления нет.
  if (order.resultDeliveredAt) {
    return { ok: true, deliveredAt: order.resultDeliveredAt, alreadyDelivered: true };
  }

  const batch = await evaluateReadinessBatch(prisma, [order as OrderForReadiness]);
  // evaluateReadinessBatch — это orders.map(): на один заказ ровно один элемент.
  const readiness = batch[0]!;
  if (!readiness.ready) return { ok: false, error: 'not_ready', readiness };

  const deliveredAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: { resultDeliveredAt: deliveredAt, resultDeliveredById: session.sub },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'order_result_delivered',
      entity: 'order',
      entityId: order.id,
      after: { deliveredAt: deliveredAt.toISOString(), serviceType: order.serviceType },
    });
  });

  // Fan-out — best-effort (§3 CLAUDE.md): сбой доставки не откатывает передачу.
  try {
    await notifyOrgUsers(prisma, {
      organizationId: order.organizationId,
      type: 'order_result_delivered',
      payload: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTitle: order.title,
        serviceType: order.serviceType,
      },
    });
  } catch (err) {
    log.warn('[orderDelivery] org notify failed', {
      orderId: order.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { ok: true, deliveredAt, alreadyDelivered: false };
}
