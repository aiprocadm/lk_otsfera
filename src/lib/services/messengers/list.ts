import type { Prisma, PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import type { MessengerChannel } from './channels';
import { DIALOG_STATUS, type DialogStatus, dialogOverdueLevel } from './dialogStatus';
import { dialogScopeWhere } from './scope';

/** Фильтр по ответственному (У-206): мои · без ответственного · все. */
type DialogAssigneeFilter = 'mine' | 'unassigned' | 'all';

/** Фолбэк порогов SLA — те же значения, что стоят умолчанием в схеме Company. */
const DEFAULT_SLA_RESPONSE_HOURS = 24;
const DEFAULT_SLA_WARNING_HOURS = 4;

export type DialogListFilters = {
  channel?: MessengerChannel | undefined;
  status?: DialogStatus | undefined;
  assignee?: DialogAssigneeFilter | undefined;
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
  /** Ответственный за диалог (У-206); null — «без ответственного». */
  assignee: { id: string; name: string } | null;
  /** Подсветка просрочки ответа (У-207): по SLA компании. */
  overdue: 'none' | 'warning' | 'overdue';
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
  waitingSince: true,
  assigneeId: true,
  assignee: { select: { id: true, name: true, email: true } },
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

type SlaHours = { responseHours: number; warningHours: number };

function toItem(row: Row, sla: SlaHours, now: Date): DialogListItem {
  return {
    id: row.id,
    channel: row.channel as MessengerChannel,
    peerLabel: peerLabelOf(row),
    organization: row.organization,
    status: row.status as DialogStatus,
    // Имя ответственного: у сотрудника ЦО оно заполнено, но пустое имя в базе
    // возможно — тогда показываем почту, иначе строка была бы пустой.
    assignee: row.assignee
      ? { id: row.assignee.id, name: row.assignee.name?.trim() || row.assignee.email }
      : null,
    overdue: dialogOverdueLevel(row, sla, now),
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
  // «Мои» — где я ответственный; «без ответственного» — очередь, которую никто
  // не взял (её и разбирают в первую очередь); «все» — без ограничения.
  if (filters.assignee === 'mine') extra.assigneeId = session.sub;
  else if (filters.assignee === 'unassigned') extra.assigneeId = null;
  const where: Prisma.MessengerDialogWhereInput = { AND: [dialogScopeWhere(session), extra] };

  // Пороги подсветки — настройка компании, как во «Входящих в работу»
  // (фолбэк на значения схемы: 24 часа на ответ, 4 часа до предупреждения).
  const thresholds = session.companyId
    ? await prisma.company.findUnique({
        where: { id: session.companyId },
        select: { slaResponseHours: true, slaWarningHours: true },
      })
    : null;
  const sla: SlaHours = {
    responseHours: thresholds?.slaResponseHours ?? DEFAULT_SLA_RESPONSE_HOURS,
    warningHours: thresholds?.slaWarningHours ?? DEFAULT_SLA_WARNING_HOURS,
  };
  const now = new Date();

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

  return { items: rows.map((row) => toItem(row, sla, now)), total };
}

/**
 * Непрочитанные входящие в незакрытых диалогах скоупа — бейдж пункта меню.
 *
 * Условие «не закрыт», а не «открыт»: с этапа 3 у живого диалога три статуса
 * (`open`, `waiting_staff`, `waiting_client`), и проверка на один из них
 * молча потеряла бы непрочитанные в остальных двух.
 */
export async function countUnreadDialogs(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<number> {
  const agg = await prisma.messengerDialog.aggregate({
    where: {
      AND: [
        dialogScopeWhere(session),
        { status: { not: DIALOG_STATUS.closed }, unreadCount: { gt: 0 } },
      ],
    },
    _sum: { unreadCount: true },
  });
  return agg._sum.unreadCount ?? 0;
}
