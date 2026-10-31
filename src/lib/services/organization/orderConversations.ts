import type { PrismaClient } from '@prisma/client';
import type { OrgOrderScope } from '@/lib/auth/organizationPolicy';

/**
 * «Сообщения → По заказам» у заказчика (`У-332`, `Д-66`, ТЗ 28.10.2026).
 *
 * Вкладка показывала только чаты, а клиент пишет менеджеру комментарием под
 * заказом (`Comment` — разговор клиент↔менеджер, CLAUDE.md §5): на стенде
 * «Комментарий от Заказчика.» и ответ менеджера были, а вкладка пустовала.
 * Здесь — заказы организации, по которым идёт переписка, свежие сверху;
 * сама переписка живёт в карточке заказа.
 *
 * Граница — организация и, при включённой настройке, только свои заказы
 * участника (`У-236`, `scope`), как у остальных экранов кабинета.
 */

const STAFF_ROLES = new Set(['manager', 'leader', 'admin']);

const ORDER_CONVERSATIONS_TAKE = 50;

export type OrgOrderConversation = {
  orderId: string;
  orderLabel: string;
  lastBody: string;
  lastAt: Date;
  /** Последнее слово за учебным центром — значит, клиенту есть что прочитать. */
  lastFromStaff: boolean;
  lastAuthorName: string;
  count: number;
};

export async function listOrgOrderConversations(
  prisma: PrismaClient,
  organizationId: string,
  scope: OrgOrderScope
): Promise<OrgOrderConversation[]> {
  const orders = await prisma.order.findMany({
    where: {
      organizationId,
      comments: { some: {} },
      ...(scope ? scope.where : {}),
    },
    // Порядок — по последнему комментарию; его считаем ниже, а здесь берём
    // свежие заказы с запасом: переписка у старых заказов редка.
    orderBy: { updatedAt: 'desc' },
    take: ORDER_CONVERSATIONS_TAKE,
    select: {
      id: true,
      orderNumber: true,
      title: true,
      _count: { select: { comments: true } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          body: true,
          createdAt: true,
          author: { select: { name: true, email: true, role: true } },
        },
      },
    },
  });

  return orders
    .flatMap((o) => {
      const last = o.comments[0];
      // `comments: { some: {} }` не пускает заказ без комментариев.
      /* v8 ignore next */
      if (!last) return [];
      const fromStaff = STAFF_ROLES.has(last.author.role);
      return [
        {
          orderId: o.id,
          orderLabel: o.orderNumber ?? `«${o.title}»`,
          lastBody: last.body,
          lastAt: last.createdAt,
          lastFromStaff: fromStaff,
          lastAuthorName: fromStaff ? 'Менеджер' : last.author.name || last.author.email,
          count: o._count.comments,
        },
      ];
    })
    .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}
