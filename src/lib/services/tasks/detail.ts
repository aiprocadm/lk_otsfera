import type { PrismaClient, TaskPriority, TaskStatus } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { auditActionLabel } from '@/lib/audit/labels';
import { resolveTaskColumns, columnForTask } from '@/lib/tasks/columns';
import { parseRecurrence, type RecurrenceRule } from '@/lib/tasks/recurrence';
import { listColleagues, type StaffColleague } from '@/lib/services/staffChat/mentions';
import { listTaskComments, type TaskCommentView } from './comments';
import { listChecklist, type ChecklistItemView } from './checklist';
import { listTaskResultFiles, type TaskResultFileRow } from './result';
import { taskChangedFieldsRu } from './tasks';

/**
 * Карточка задачи (`У-218`) — всё, что показывает страница `/…/tasks/[id]`.
 *
 * До этапа 4 задача жила только в модальном окне: открыть её по ссылке было
 * нельзя, а значит нельзя было ни переслать коллеге, ни сослаться на неё из
 * уведомления. Отсюда и отдельная страница, и этот сервис.
 *
 * Гард — `canSeeTask` (§4 defense-in-depth): страница зовёт его же, но выборка
 * обязана отказывать сама. Чужая задача отвечает `not_found`, а не `forbidden`:
 * её существование наружу не подтверждаем.
 */

type TaskHistoryEntry = {
  id: string;
  at: Date;
  action: string;
  /** Этап 5 ТЗ 13.10.2026 (`У-302`): что поменяли при правке — «срок, исполнители». */
  details: string | null;
  actorName: string | null;
};

export type TaskDetail = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority | null;
  dueDate: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  createdById: string;
  createdByName: string;
  /** `У-223`: задача, созданная роботом, честно говорит об этом. */
  createdByRuleId: string | null;
  /** `У-221`: правило повторения; `null` — задача разовая. */
  recurrence: RecurrenceRule | null;
  columnId: string;
  columnName: string;
  /** Ответственные исполнители. */
  assignees: { id: string; name: string }[];
  /** Этап 5 ТЗ 13.10.2026 (`У-299`, `Р-5-1`): соисполнители. */
  coAssignees: { id: string; name: string }[];
  /** `Р-5-4`: теги. */
  tags: string[];
  /** `Р-5-3`: результат — текст и файлы. */
  result: string | null;
  resultUpdatedAt: Date | null;
  resultFiles: TaskResultFileRow[];
  links: { kind: 'order' | 'organization' | 'lead' | 'deal'; id: string; title: string }[];
  checklist: ChecklistItemView[];
  comments: TaskCommentView[];
  /**
   * `У-282` (`Д-57`): кого можно позвать «@» в обсуждении — тот же список,
   * по которому сервер распознаёт упоминание (`listColleagues`). Подсказка при
   * вводе и разбор на сервере не могут разойтись.
   */
  colleagues: StaffColleague[];
  history: TaskHistoryEntry[];
};

/** Сколько записей истории показывает карточка; полный журнал — в разделе аудита. */
const HISTORY_CAP = 50;

export async function getTaskDetail(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true; task: TaskDetail } | { ok: false; error: 'forbidden' | 'not_found' }> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const row = await prisma.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      completedAt: true,
      createdAt: true,
      createdById: true,
      createdByRuleId: true,
      recurrence: true,
      columnId: true,
      companyId: true,
      tags: true,
      result: true,
      resultUpdatedAt: true,
      linkedOrderId: true,
      linkedOrganizationId: true,
      linkedLeadId: true,
      linkedDealId: true,
      createdBy: { select: { name: true } },
      assignees: { select: { userId: true, role: true, user: { select: { name: true } } } },
      linkedOrder: { select: { title: true } },
      linkedOrganization: { select: { name: true } },
      linkedLead: { select: { subject: true } },
      linkedDeal: { select: { title: true } },
    },
  });
  if (!row) return { ok: false, error: 'not_found' };

  const visible = canSeeTask(session, {
    companyId: row.companyId,
    createdById: row.createdById,
    assigneeUserIds: row.assignees.map((a) => a.userId),
    linkedOrganizationId: row.linkedOrganizationId,
  });
  if (!visible) return { ok: false, error: 'not_found' };

  const columns = await resolveTaskColumns(prisma, row.companyId);
  const column = columnForTask(columns, row);

  const [checklist, comments, colleagues, historyRows, resultFiles] = await Promise.all([
    listChecklist(prisma, row.id),
    listTaskComments(prisma, row.id),
    listColleagues(prisma, session),
    prisma.auditLog.findMany({
      where: { entity: 'task', entityId: row.id },
      select: {
        id: true,
        action: true,
        createdAt: true,
        meta: true,
        user: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_CAP,
    }),
    listTaskResultFiles(prisma, session, row),
  ]);

  const links: TaskDetail['links'] = [];
  if (row.linkedOrderId)
    links.push({
      kind: 'order',
      id: row.linkedOrderId,
      title: row.linkedOrder?.title ?? 'Заказ',
    });
  if (row.linkedOrganizationId)
    links.push({
      kind: 'organization',
      id: row.linkedOrganizationId,
      title: row.linkedOrganization?.name ?? 'Организация',
    });
  if (row.linkedLeadId)
    links.push({ kind: 'lead', id: row.linkedLeadId, title: row.linkedLead?.subject ?? 'Лид' });
  if (row.linkedDealId)
    links.push({ kind: 'deal', id: row.linkedDealId, title: row.linkedDeal?.title ?? 'Сделка' });

  return {
    ok: true,
    task: {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      dueDate: row.dueDate,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      createdById: row.createdById,
      createdByName: row.createdBy.name,
      createdByRuleId: row.createdByRuleId,
      recurrence: parseRecurrence(row.recurrence),
      // Колонка может не найтись, если компания перенастроила набор и статус
      // задачи остался без якоря — показываем статус, а не пустоту.
      columnId: column?.id ?? row.status,
      columnName: column?.name ?? row.status,
      assignees: row.assignees
        .filter((a) => a.role === 'executor')
        .map((a) => ({ id: a.userId, name: a.user.name })),
      coAssignees: row.assignees
        .filter((a) => a.role === 'co_executor')
        .map((a) => ({ id: a.userId, name: a.user.name })),
      tags: row.tags,
      result: row.result,
      resultUpdatedAt: row.resultUpdatedAt,
      resultFiles,
      links,
      checklist,
      comments,
      // Себя не зовут: упоминание самого себя сервер и так отбрасывает.
      colleagues: colleagues.rows.filter((c) => c.id !== session.sub),
      history: historyRows.map((h) => {
        // `У-302`: правка показывает, что поменяли (`after.changed` пишет `updateTask`).
        const after = (h.meta as { after?: { changed?: unknown } } | null)?.after;
        const fields = taskChangedFieldsRu(after?.changed);
        return {
          id: h.id,
          at: h.createdAt,
          action: auditActionLabel(h.action),
          details: fields.length > 0 ? fields.join(', ') : null,
          actorName: h.user?.name ?? null,
        };
      }),
    },
  };
}
