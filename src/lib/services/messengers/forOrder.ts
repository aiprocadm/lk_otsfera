import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { dialogScopeWhere } from './scope';

/**
 * «Переписка с клиентом» в карточке заказа (`У-210`).
 *
 * Заказ не ведёт свою переписку: разговор идёт с человеком и с организацией.
 * Поэтому берём диалоги контакта заказа (`Order.primaryContactId`) и диалоги
 * его организации — ровно те два адреса, по которым заказ связан с живыми
 * людьми. Порядок такой же, как везде: свежие сверху.
 *
 * Панель короткая: это карточка заказа, а не раздел переписки. Полный список —
 * во вкладке «Диалоги» карточки организации и в «Мессенджерах».
 */
export const ORDER_DIALOGS_CAP = 5;

export type OrderDialogRow = {
  id: string;
  channel: string;
  status: string;
  /** Имя собеседника, если известно; иначе адрес — как в списке диалогов. */
  peerLabel: string;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
};

export type OrderDialogsShape = {
  organizationId: string | null;
  primaryContactId: string | null;
};

export type OrderDialogsResult = {
  rows: OrderDialogRow[];
  /**
   * Сколько диалогов всего. Панель показывает только несколько свежих, и без
   * этого числа список молча обрезался бы: человек видел бы пять строк и думал,
   * что это вся переписка (`С-6` — молчаливое усечение это дефект).
   */
  total: number;
};

export async function listOrderDialogs(
  prisma: PrismaClient,
  session: SessionPayload,
  order: OrderDialogsShape
): Promise<OrderDialogsResult> {
  // Ни контакта, ни организации — связать переписку не с чем. Пустой список, а
  // не запрос «по всей базе»: условие `OR: []` в Prisma не отбирает ничего, но
  // полагаться на это неочевидное поведение нельзя.
  const targets: Prisma.MessengerDialogWhereInput[] = [];
  if (order.primaryContactId) targets.push({ contactId: order.primaryContactId });
  if (order.organizationId) targets.push({ organizationId: order.organizationId });
  if (targets.length === 0) return { rows: [], total: 0 };

  const where = { AND: [dialogScopeWhere(session), { OR: targets }] };
  const [rows, total] = await Promise.all([
    prisma.messengerDialog.findMany({
      // Скоуп поверх (CLAUDE.md §4): карточка заказа уже проверена, но граница
      // компании держится и здесь — сокращать её нельзя.
      where,
      select: {
        id: true,
        channel: true,
        status: true,
        peerDisplay: true,
        peerRef: true,
        lastMessageAt: true,
        lastMessagePreview: true,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: ORDER_DIALOGS_CAP,
    }),
    // Счётчик по ТОМУ ЖЕ условию, что и выборка: иначе «показаны 5 из N»
    // однажды начнёт врать.
    prisma.messengerDialog.count({ where }),
  ]);

  await recordPiiAccess(prisma, {
    session,
    context: 'order_card_dialogs',
    subjectIds: rows.map((r) => r.id),
  });

  return {
    rows: rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      status: r.status,
      peerLabel: r.peerDisplay?.trim() || r.peerRef,
      lastMessageAt: r.lastMessageAt,
      lastMessagePreview: r.lastMessagePreview,
    })),
    total,
  };
}
