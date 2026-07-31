import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { taskFiltersWhere } from '@/lib/services/tasks/board';
import { clientRequestScopeWhere } from '@/lib/services/clientRequests/list';
import { unreadCount } from '@/lib/services/chat/threads';
import { countIntake } from './list';

/**
 * Счётчики бейджей меню сотрудника — один вызов на поллинг
 * (роут `/api/staff/badges`, обновление раз в 30 с в `nav-badge`).
 *
 * Этап 7 (ФТ-8.4): непустой Intake и просроченные задачи (ФТ-7.3).
 * Этап 11 (ФТ-15.2): + новые обращения клиентов и непрочитанная переписка —
 * ровно тот набор, который называет ТЗ. Каждый счётчик считается своим уже
 * существующим скоупом (C8), новых правил видимости здесь не появляется.
 */

export type StaffBadges = {
  intake: number;
  tasksOverdue: number;
  /** ФТ-15.2: обращения клиентов, ещё не взятые в работу. */
  clientRequestsNew: number;
  /** ФТ-15.2: треды с сообщениями новее отметки о прочтении. */
  messagesUnread: number;
};

export async function getStaffBadges(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<StaffBadges> {
  const [intake, tasksOverdue, clientRequestsNew, unread] = await Promise.all([
    countIntake(prisma, session),
    prisma.task.count({ where: taskFiltersWhere(session, { overdue: true }, new Date()) }),
    prisma.clientRequest.count({
      where: { AND: [clientRequestScopeWhere(session), { status: 'submitted' }] },
    }),
    unreadCount(prisma, session),
  ]);
  return {
    intake,
    tasksOverdue,
    clientRequestsNew,
    // unreadCount не умеет отказывать: его тип — только { ok: true; count },
    // вне скоупа он возвращает count: 0. Прежняя проверка `unread.ok ? … : 0`
    // была недостижимой веткой (Ф2 программы покрытия — такое удаляем).
    messagesUnread: unread.count,
  };
}
