import type { PrismaClient } from '@prisma/client';

/**
 * Карточка заказа для админского зеркала (Model A): без скоупа по компании —
 * гард `requireAdmin` остаётся на странице, сервис только читает.
 *
 * Возвращает заказ вместе с организацией, партнёром и назначенным менеджером;
 * `null` — заказа нет (страница отвечает `notFound()`).
 */
export async function getOrderForAdmin(prisma: PrismaClient, id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, email: true } },
    },
  });
}
