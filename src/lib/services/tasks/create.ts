import { Prisma, type TaskPriority, type TaskStatus } from '@prisma/client';

/**
 * Ядро создания задачи — общее для всех, кто её заводит.
 *
 * Отдельным файлом, а не внутри `tasks.ts`, потому что задачу создают три
 * разных места: человек через форму, правило автоматизации (`У-223`) и
 * повторяющаяся серия (`У-221`). Последняя живёт в `recurrence.ts`, который
 * зовут из `tasks.ts`, — держать ядро там значило бы замкнуть импорты в кольцо,
 * а кольца запрещены (`npm run boundaries`).
 */

export async function createTaskCore(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    createdById: string;
    title: string;
    description?: string | null;
    priority?: TaskPriority | null;
    dueDate?: Date | null;
    status: TaskStatus;
    /** Уже разрешённая колонка: `null` — синтетический дефолт (колонка выводится из статуса). */
    columnId: string | null;
    completedAt: Date | null;
    linkedOrderId?: string | null;
    linkedOrganizationId?: string | null;
    linkedLeadId?: string | null;
    linkedDealId?: string | null;
    linkedContactId?: string | null;
    linkedDialogId?: string | null;
    linkedDocumentId?: string | null;
    assigneeIds?: string[] | undefined;
    /** `У-223`: какое правило автоматизации породило задачу. */
    createdByRuleId?: string | null;
    /** `У-221`: правило повторения; `null`/пропуск — задача разовая. */
    recurrence?: Prisma.InputJsonValue | null;
  }
): Promise<{ id: string; title: string; dueDate: Date | null }> {
  const task = await tx.task.create({
    data: {
      companyId: input.companyId,
      createdById: input.createdById,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? null,
      dueDate: input.dueDate ?? null,
      status: input.status,
      columnId: input.columnId,
      completedAt: input.completedAt,
      linkedOrderId: input.linkedOrderId ?? null,
      linkedOrganizationId: input.linkedOrganizationId ?? null,
      linkedLeadId: input.linkedLeadId ?? null,
      linkedDealId: input.linkedDealId ?? null,
      linkedContactId: input.linkedContactId ?? null,
      linkedDialogId: input.linkedDialogId ?? null,
      linkedDocumentId: input.linkedDocumentId ?? null,
      createdByRuleId: input.createdByRuleId ?? null,
      // Json-поле: «нет значения» в Prisma — это `DbNull`, а не `null`.
      recurrence: input.recurrence ?? Prisma.DbNull,
    },
    select: { id: true, title: true, dueDate: true },
  });
  const assignees = [...new Set(input.assigneeIds ?? [])];
  if (assignees.length > 0) {
    await tx.taskAssignee.createMany({
      data: assignees.map((userId) => ({ taskId: task.id, userId })),
    });
  }
  return task;
}
