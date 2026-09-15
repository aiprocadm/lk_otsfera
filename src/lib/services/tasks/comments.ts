import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canSeeTask } from '@/lib/auth/accessProfile';
import { recordAudit } from '@/lib/auth/audit';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { notifyNoteMention } from '@/lib/notifications/noteMention';
import { extractMentions, listColleagues } from '@/lib/services/staffChat/mentions';
import { log } from '@/lib/logging';

/**
 * Обсуждение внутри задачи (`У-218`, спека этапа 4 §3.8).
 *
 * Своя модель `TaskComment`, а не `Comment`: `Comment` — это разговор клиента с
 * менеджером по заказу, он виден заказчику (CLAUDE.md §5). Задачи клиентскому
 * контуру не видны вообще, и класть внутреннее обсуждение в таблицу, которую
 * читает кабинет клиента, нельзя.
 *
 * Единственный продьюсер типа `task_comment` (страж реестра уведомлений держит
 * это правило). Упоминание через `@` шлёт общий `note_mention` этапа 1 — второго
 * типа под то же событие не заводим.
 */

export type TaskCommentErrorCode = 'forbidden' | 'not_found' | 'validation';

const TASK_COMMENT_MAX = 4000;
/** Сколько комментариев показывает карточка. Переписка в задаче короткая. */
const TASK_COMMENTS_CAP = 200;

export type TaskCommentView = {
  id: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  body: string;
};

const SCOPE_SELECT = {
  id: true,
  title: true,
  companyId: true,
  createdById: true,
  linkedOrganizationId: true,
  assignees: { select: { userId: true } },
} as const;

export async function listTaskComments(
  prisma: PrismaClient,
  taskId: string
): Promise<TaskCommentView[]> {
  const rows = await prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: 'asc' },
    take: TASK_COMMENTS_CAP,
    select: {
      id: true,
      createdAt: true,
      authorId: true,
      body: true,
      author: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    authorId: r.authorId,
    authorName: r.author.name,
    body: r.body,
  }));
}

export async function addTaskComment(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { taskId: string; body: string }
): Promise<{ ok: true; id: string } | { ok: false; error: TaskCommentErrorCode }> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };
  const body = args.body.trim();
  if (!body || body.length > TASK_COMMENT_MAX) return { ok: false, error: 'validation' };

  const task = await prisma.task.findUnique({ where: { id: args.taskId }, select: SCOPE_SELECT });
  if (!task) return { ok: false, error: 'not_found' };
  const assigneeUserIds = task.assignees.map((a) => a.userId);
  const visible = canSeeTask(session, {
    companyId: task.companyId,
    createdById: task.createdById,
    assigneeUserIds,
    linkedOrganizationId: task.linkedOrganizationId,
  });
  // Чужая задача → `not_found`: существование её наружу не подтверждаем.
  if (!visible) return { ok: false, error: 'not_found' };

  // Упоминания разбираются ДО записи: список id хранится в самой строке, иначе
  // «кого звали» пришлось бы вычислять заново при каждом показе, а имена к тому
  // времени могут поменяться.
  let mentioned: string[] = [];
  if (body.includes('@')) {
    const colleagues = await listColleagues(prisma, session);
    mentioned = extractMentions(body, colleagues.rows).filter((id) => id !== session.sub);
  }

  const comment = await prisma.$transaction(async (tx) => {
    const created = await tx.taskComment.create({
      data: { taskId: task.id, authorId: session.sub, body, mentionUserIds: mentioned },
      select: { id: true },
    });
    // В журнал попадает факт и id, но НЕ текст: аудит — канал расследования, а
    // не вторая копия переписки (§12).
    await recordAudit(tx, {
      userId: session.sub,
      action: 'task_comment_added',
      entity: 'task',
      entityId: task.id,
      after: { commentId: created.id, mentioned: mentioned.length },
    });
    return created;
  });

  await notifyTaskComment({
    taskId: task.id,
    taskTitle: task.title,
    commentId: comment.id,
    body,
    actorUserId: session.sub,
    recipientUserIds: [...assigneeUserIds, task.createdById],
    mentionedUserIds: mentioned,
  });

  // Упоминания — общим продьюсером этапа 1, а не вторым типом под то же
  // событие. `notifyNoteMention` сам никогда не бросает (fail-open).
  await notifyNoteMention(prisma, {
    mentionedUserIds: mentioned,
    entity: 'task',
    entityId: task.id,
    noteId: comment.id,
    body,
    managerPath: `/manager/tasks/${task.id}`,
  });

  return { ok: true, id: comment.id };
}

const EXCERPT_MAX = 200;

/**
 * Кому уходит `task_comment`: исполнителям и создателю, кроме автора и кроме
 * тех, кого уже позвали по имени — упомянутый получает `note_mention`, и два
 * уведомления об одной строке были бы шумом, от которого уведомления
 * выключают целиком.
 *
 * Fail-open (§3 CLAUDE.md): сбой доставки логируется и проглатывается —
 * комментарий уже сохранён, отменять его из-за почты нельзя.
 */
async function notifyTaskComment(args: {
  taskId: string;
  taskTitle: string;
  commentId: string;
  body: string;
  actorUserId: string;
  recipientUserIds: string[];
  mentionedUserIds: string[];
}): Promise<void> {
  const mentioned = new Set(args.mentionedUserIds);
  const recipients = [...new Set(args.recipientUserIds)].filter(
    (id) => id !== args.actorUserId && !mentioned.has(id)
  );

  const title = 'Новый комментарий в задаче';
  const excerpt = args.body.slice(0, EXCERPT_MAX);
  const url = `/manager/tasks/${args.taskId}`;

  for (const userId of recipients) {
    try {
      const row = await createNotification({
        userId,
        type: 'task_comment',
        title,
        body: `«${args.taskTitle}»: ${excerpt}`,
        meta: { taskId: args.taskId, commentId: args.commentId, url },
      });
      await deliverNotificationToUser({
        userId,
        title,
        body: `«${args.taskTitle}»: ${excerpt}`,
        type: 'task_comment',
        url,
        dedupKey: row.id,
      });
    } catch (e) {
      log.error('[tasks/comments] task_comment fan-out failed', {
        taskId: args.taskId,
        userId,
        error: (e as Error).message,
      });
    }
  }
}
