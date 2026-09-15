import type { PrismaClient, TaskPriority, TaskStatus } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { auditActionLabel } from '@/lib/audit/labels';
import { resolveTaskColumns, columnForTask } from '@/lib/tasks/columns';
import { listTaskComments, type TaskCommentView } from './comments';
import { listChecklist, type ChecklistItemView } from './checklist';

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
  columnId: string;
  columnName: string;
  assignees: { id: string; name: string }[];
  links: { kind: 'order' | 'organization' | 'lead' | 'deal'; id: string; title: string }[];
  checklist: ChecklistItemView[];
  comments: TaskCommentView[];
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
      columnId: true,
      companyId: true,
      linkedOrderId: true,
      linkedOrganizationId: true,
      linkedLeadId: true,
      linkedDealId: true,
      createdBy: { select: { name: true } },
      assignees: { select: { userId: true, user: { select: { name: true } } } },
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

  const [checklist, comments, historyRows] = await Promise.all([
    listChecklist(prisma, row.id),
    listTaskComments(prisma, row.id),
    prisma.auditLog.findMany({
      where: { entity: 'task', entityId: row.id },
      select: { id: true, action: true, createdAt: true, user: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_CAP,
    }),
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
      // Колонка может не найтись, если компания перенастроила набор и статус
      // задачи остался без якоря — показываем статус, а не пустоту.
      columnId: column?.id ?? row.status,
      columnName: column?.name ?? row.status,
      assignees: row.assignees.map((a) => ({ id: a.userId, name: a.user.name })),
      links,
      checklist,
      comments,
      history: historyRows.map((h) => ({
        id: h.id,
        at: h.createdAt,
        action: auditActionLabel(h.action),
        actorName: h.user?.name ?? null,
      })),
    },
  };
}
