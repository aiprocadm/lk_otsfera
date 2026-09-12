import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { isMessengerAvailable } from './availability';
import type { MessengerChannel } from './channels';
import type { DialogStatus } from './list';
import { peerLabelOf } from './list';
import { dialogScopeWhere, isDialogInScope } from './scope';

/** Сколько последних сообщений показывает карточка диалога. */
const DIALOG_MESSAGES_CAP = 200;

export type DialogMessageView = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  createdAt: Date;
  /** sent | failed — у исходящих; у входящих всегда sent. */
  deliveryStatus: string;
  /** Имя сотрудника у исходящих; null — входящее. */
  authorName: string | null;
};

type DialogView = {
  id: string;
  channel: MessengerChannel;
  /** Канал подключён (ключи + флаг): без него форма ответа заменяется подсказкой. */
  channelAvailable: boolean;
  peerLabel: string;
  peerRef: string;
  status: DialogStatus;
  unreadCount: number;
  bound: boolean;
  organization: { id: string; name: string } | null;
  contact: { id: string; name: string } | null;
  user: { id: string; name: string | null } | null;
  messages: DialogMessageView[];
  /** Сообщений старше показанных: сколько не вошло в карточку. */
  hiddenCount: number;
  /** Последнее входящее письмо — источник для «Создать лид» / «Задача». */
  lastInbound: { inboundMessageId: string; body: string } | null;
};

export type GetDialogResult = { ok: true; dialog: DialogView } | { ok: false; error: 'not_found' };

const VIEW_SELECT = {
  id: true,
  channel: true,
  peerRef: true,
  peerDisplay: true,
  companyId: true,
  status: true,
  unreadCount: true,
  organization: { select: { id: true, name: true } },
  contact: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, email: true } },
  _count: { select: { messages: true } },
  messages: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: DIALOG_MESSAGES_CAP,
    select: {
      id: true,
      direction: true,
      body: true,
      createdAt: true,
      deliveryStatus: true,
      authorId: true,
      inboundMessageId: true,
    },
  },
} satisfies Prisma.MessengerDialogSelect;

/**
 * Карточка диалога (спека 2026-09-12 §5.2). Диалог вне скоупа отвечает
 * `not_found`, а не `forbidden`: существование чужой переписки не раскрываем.
 */
export async function getDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  dialogId: string
): Promise<GetDialogResult> {
  const row = await prisma.messengerDialog.findUnique({
    where: { id: dialogId },
    select: VIEW_SELECT,
  });
  if (!row || !isDialogInScope(session, row)) return { ok: false, error: 'not_found' };

  // Имена авторов исходящих — одним запросом, без внешнего ключа (см. схему).
  const authorIds = [
    ...new Set(row.messages.map((m) => m.authorId).filter((id): id is string => id !== null)),
  ];
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const nameOf = new Map(authors.map((a) => [a.id, a.name?.trim() || a.email]));

  // Выборка — от новых к старым (чтобы взять последние N); показываем по порядку.
  const ordered = [...row.messages].reverse();
  const lastIn = row.messages.find((m) => m.direction === 'in' && m.inboundMessageId !== null);

  await recordPiiAccess(prisma, {
    session,
    context: 'messengers_view',
    subjectIds: [row.id],
  });

  return {
    ok: true,
    dialog: {
      id: row.id,
      channel: row.channel as MessengerChannel,
      channelAvailable: isMessengerAvailable(row.channel as MessengerChannel),
      peerLabel: peerLabelOf(row),
      peerRef: row.peerRef,
      status: row.status as DialogStatus,
      unreadCount: row.unreadCount,
      bound: row.companyId !== null,
      organization: row.organization,
      contact: row.contact,
      user: row.user ? { id: row.user.id, name: row.user.name } : null,
      messages: ordered.map((m) => ({
        id: m.id,
        direction: m.direction as 'in' | 'out',
        body: m.body,
        createdAt: m.createdAt,
        deliveryStatus: m.deliveryStatus,
        authorName: m.authorId ? (nameOf.get(m.authorId) ?? null) : null,
      })),
      hiddenCount: Math.max(0, row._count.messages - row.messages.length),
      lastInbound: lastIn
        ? { inboundMessageId: lastIn.inboundMessageId!, body: lastIn.body }
        : null,
    },
  };
}

/**
 * Открытие диалога сотрудником снимает непрочитанное. Условие скоупа — в
 * `where`: чужой диалог этим не «прочитаешь». Идемпотентно (`unreadCount > 0`).
 */
export async function markDialogRead(
  prisma: PrismaClient,
  session: SessionPayload,
  dialogId: string
): Promise<void> {
  await prisma.messengerDialog.updateMany({
    where: { AND: [{ id: dialogId, unreadCount: { gt: 0 } }, dialogScopeWhere(session)] },
    data: { unreadCount: 0 },
  });
}
