import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import type { MessengerChannel } from './channels';
import { dialogScopeWhere } from './scope';

export type DialogStatus = 'open' | 'closed';

export type DialogListFilters = {
  channel?: MessengerChannel | undefined;
  status?: DialogStatus | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

export type DialogListItem = {
  id: string;
  channel: MessengerChannel;
  /** Как назвать собеседника: контакт → пользователь кабинета → имя из мессенджера → адрес. */
  peerLabel: string;
  organization: { id: string; name: string } | null;
  status: DialogStatus;
  unreadCount: number;
  lastMessageAt: Date;
  lastMessagePreview: string | null;
  lastMessageDirection: 'in' | 'out' | null;
  /** false — общая очередь: диалог ещё ничей. */
  bound: boolean;
};

export type DialogListResult = { items: DialogListItem[]; total: number };

const LIST_SELECT = {
  id: true,
  channel: true,
  peerRef: true,
  peerDisplay: true,
  companyId: true,
  status: true,
  unreadCount: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  lastMessageDirection: true,
  organization: { select: { id: true, name: true } },
  contact: { select: { name: true } },
  user: { select: { name: true, email: true } },
} satisfies Prisma.MessengerDialogSelect;

type Row = Prisma.MessengerDialogGetPayload<{ select: typeof LIST_SELECT }>;

/** Имя собеседника по убыванию надёжности источника. */
export function peerLabelOf(row: {
  peerRef: string;
  peerDisplay: string | null;
  contact: { name: string } | null;
  user: { name: string | null; email: string } | null;
}): string {
  return (
    row.contact?.name?.trim() ||
    row.user?.name?.trim() ||
    row.user?.email ||
    row.peerDisplay?.trim() ||
    row.peerRef
  );
}

function toItem(row: Row): DialogListItem {
  return {
    id: row.id,
    channel: row.channel as MessengerChannel,
    peerLabel: peerLabelOf(row),
    organization: row.organization,
    status: row.status as DialogStatus,
    unreadCount: row.unreadCount,
    lastMessageAt: row.lastMessageAt,
    lastMessagePreview: row.lastMessagePreview,
    lastMessageDirection: row.lastMessageDirection as 'in' | 'out' | null,
    bound: row.companyId !== null,
  };
}

/**
 * Список диалогов сотрудника (спека 2026-09-12 §5.1). Одна выборка: превью и
 * счётчик непрочитанных лежат на самом диалоге, по сообщениям не ходим.
 * Скоуп — `dialogScopeWhere` (своя компания + общая очередь, Р-М-3).
 */
export async function listDialogs(
  prisma: PrismaClient,
  session: SessionPayload,
  filters: DialogListFilters = {}
): Promise<DialogListResult> {
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);

  const extra: Prisma.MessengerDialogWhereInput = {};
  if (filters.channel) extra.channel = filters.channel;
  if (filters.status) extra.status = filters.status;
  const where: Prisma.MessengerDialogWhereInput = { AND: [dialogScopeWhere(session), extra] };

  const [rows, total] = await Promise.all([
    prisma.messengerDialog.findMany({
      where,
      select: LIST_SELECT,
      // Хвост `id` — устойчивый порядок при одинаковом времени (бэкфилл).
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.messengerDialog.count({ where }),
  ]);

  await recordPiiAccess(prisma, {
    session,
    context: 'messengers_list',
    subjectIds: rows.map((r) => r.id),
  });

  return { items: rows.map(toItem), total };
}

/** Непрочитанные входящие в открытых диалогах скоупа — бейдж пункта меню. */
export async function countUnreadDialogs(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<number> {
  const agg = await prisma.messengerDialog.aggregate({
    where: { AND: [dialogScopeWhere(session), { status: 'open', unreadCount: { gt: 0 } }] },
    _sum: { unreadCount: true },
  });
  return agg._sum.unreadCount ?? 0;
}
