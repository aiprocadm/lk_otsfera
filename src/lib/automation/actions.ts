import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { log } from '@/lib/logging';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { createTaskCore } from '@/lib/services/tasks/tasks';
import { resolveTaskColumns } from '@/lib/tasks/columns';
import type { AutomationEventPayload } from './conditions';
import { renderAutomationText, checkAutomationPlaceholders } from './templates';

/**
 * Действия правил (`У-222`, `У-223`).
 *
 * ЭТОТ ФАЙЛ НЕ ИМЕЕТ ПРАВА ИСПУСКАТЬ СОБЫТИЯ. Он не импортирует
 * `emitAutomationEvent` и не может его позвать — это второй из трёх заслонов
 * против зацикливания (`Р-Б-6`). Запрет продублирован правилом
 * dependency-cruiser `automation-actions-cannot-emit`, чтобы нарушение красило
 * сборку, а не ждало внимательного ревьюера, и проверяется стражем
 * `automation.no-loop`.
 *
 * Каждое действие возвращает результат, а НЕ бросает: сбой одного действия не
 * должен ни отменять бизнес-операцию (fail-open §3), ни мешать соседним
 * действиям того же правила. Причина отказа ложится в журнал срабатываний.
 */

/** Кому назначить задачу или кому слать уведомление. */
const assigneeSchema = z.union([
  z.literal('responsible_manager'),
  z.literal('role:leader'),
  z.string().regex(/^user:[A-Za-z0-9_-]+$/),
]);

export const actionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create_task'),
    titleTemplate: z.string().trim().min(1).max(200),
    descriptionTemplate: z.string().trim().max(5000).optional(),
    assignee: assigneeSchema,
    dueInDays: z.number().int().min(0).max(365).optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }),
  z.object({
    kind: z.literal('notify'),
    audience: assigneeSchema,
    template: z.string().trim().min(1).max(1000),
  }),
  z.object({
    kind: z.literal('send_message'),
    channel: z.enum(['email', 'messenger']),
    template: z.string().trim().min(1).max(4000),
  }),
]);

export type AutomationAction = z.infer<typeof actionSchema>;

export const actionsSchema = z.array(actionSchema).min(1).max(5);

/**
 * Проверка текстов действия при СОХРАНЕНИИ правила: неизвестная подстановка —
 * отказ, а не тихая пустота в готовой задаче (§9 пакета).
 */
export function checkActionTemplates(
  actions: AutomationAction[]
): { ok: true } | { ok: false; unknown: string[] } {
  const texts: string[] = [];
  for (const action of actions) {
    if (action.kind === 'create_task') {
      texts.push(action.titleTemplate);
      if (action.descriptionTemplate) texts.push(action.descriptionTemplate);
    } else {
      texts.push(action.template);
    }
  }
  return checkAutomationPlaceholders(...texts);
}

export type ActionOutcome = {
  createdTaskIds: string[];
  notifiedUserIds: string[];
  /** Непустая строка — действие не выполнено, причина по-русски. */
  error: string | null;
};

const EMPTY: ActionOutcome = { createdTaskIds: [], notifiedUserIds: [], error: null };

/**
 * Кто исполнитель/получатель (`Р-Э4-5`).
 *
 * Порядок: ответственный менеджер объекта → все руководители компании → никто.
 * Последний случай не молчит: прогон получает пометку, а задача создаётся без
 * исполнителя и видна на доске в «Без исполнителя». Робот, который иногда
 * ничего не делает и не говорит об этом, хуже отсутствующего робота.
 */
export async function resolveRecipients(
  prisma: PrismaClient,
  args: { companyId: string; target: string; payload: AutomationEventPayload }
): Promise<{ userIds: string[]; note: string | null }> {
  const { companyId, target, payload } = args;

  if (target.startsWith('user:')) {
    const userId = target.slice('user:'.length);
    const user = await prisma.user.findFirst({
      where: { id: userId, companyId, isActive: true },
      select: { id: true },
    });
    // Сотрудника уволили или перевели — правило не должно писать в пустоту.
    return user ? { userIds: [user.id], note: null } : { userIds: [], note: 'сотрудник не найден' };
  }

  if (target === 'role:leader') {
    const leaders = await leadersOf(prisma, companyId);
    return leaders.length > 0
      ? { userIds: leaders, note: null }
      : { userIds: [], note: 'в компании нет руководителя' };
  }

  // responsible_manager
  if (payload.responsibleManagerId) {
    const manager = await prisma.user.findFirst({
      where: { id: payload.responsibleManagerId, companyId, isActive: true },
      select: { id: true },
    });
    if (manager) return { userIds: [manager.id], note: null };
  }
  const leaders = await leadersOf(prisma, companyId);
  if (leaders.length > 0) {
    return { userIds: leaders, note: 'у объекта нет ответственного менеджера' };
  }
  return { userIds: [], note: 'у объекта нет ответственного менеджера, руководителей в компании нет' };
}

async function leadersOf(prisma: PrismaClient, companyId: string): Promise<string[]> {
  const rows = await prisma.user.findMany({
    where: { companyId, role: 'leader', isActive: true },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** `create_task`: поставить задачу. */
export async function runCreateTask(
  prisma: PrismaClient,
  args: {
    action: Extract<AutomationAction, { kind: 'create_task' }>;
    companyId: string;
    ruleId: string;
    /** Автор задачи — человек, включивший правило (`Р-Э4-4`). */
    authorId: string;
    payload: AutomationEventPayload;
  }
): Promise<ActionOutcome> {
  const { action, companyId, ruleId, authorId, payload } = args;
  const recipients = await resolveRecipients(prisma, {
    companyId,
    target: action.assignee,
    payload,
  });

  const title = renderAutomationText(action.titleTemplate, payload);
  const parts = [
    action.descriptionTemplate ? renderAutomationText(action.descriptionTemplate, payload) : '',
    recipients.note ? `Кому: ${recipients.note}.` : '',
  ].filter(Boolean);

  const columns = await resolveTaskColumns(prisma, companyId);
  const first = columns[0];
  if (!first) return { ...EMPTY, error: 'у компании нет ни одной колонки задач' };

  const dueDate =
    action.dueInDays === undefined
      ? null
      : new Date(Date.now() + action.dueInDays * 24 * 60 * 60 * 1000);

  const task = await prisma.$transaction(async (tx) =>
    createTaskCore(tx as Prisma.TransactionClient, {
      companyId,
      createdById: authorId,
      title,
      description: parts.length > 0 ? parts.join('\n\n') : null,
      priority: action.priority ?? null,
      dueDate,
      status: first.statusAnchor,
      columnId: first.id.startsWith('default:') ? null : first.id,
      completedAt: null,
      linkedOrderId: asId(payload.orderId),
      linkedOrganizationId: asId(payload.organizationId),
      linkedLeadId: asId(payload.leadId),
      linkedDealId: asId(payload.dealId),
      linkedDocumentId: asId(payload.documentId),
      linkedDialogId: asId(payload.dialogId),
      assigneeIds: recipients.userIds,
      createdByRuleId: ruleId,
    })
  );

  return {
    createdTaskIds: [task.id],
    notifiedUserIds: [],
    // Задача создана — это НЕ ошибка; отсутствие исполнителя записано в
    // описание задачи и здесь, чтобы журнал не выглядел безупречным.
    error: recipients.userIds.length === 0 ? `задача без исполнителя: ${recipients.note}` : null,
  };
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** `notify`: сообщить сотруднику. */
export async function runNotify(
  prisma: PrismaClient,
  args: {
    action: Extract<AutomationAction, { kind: 'notify' }>;
    companyId: string;
    ruleName: string;
    payload: AutomationEventPayload;
  }
): Promise<ActionOutcome> {
  const { action, companyId, ruleName, payload } = args;
  const recipients = await resolveRecipients(prisma, {
    companyId,
    target: action.audience,
    payload,
  });
  if (recipients.userIds.length === 0) {
    return { ...EMPTY, error: `некому отправить: ${recipients.note ?? 'получатель не найден'}` };
  }

  const body = renderAutomationText(action.template, payload);
  const title = `Правило «${ruleName}»`;
  const notified: string[] = [];
  for (const userId of recipients.userIds) {
    try {
      const row = await createNotification({
        userId,
        type: 'automation_notice',
        title,
        body,
      });
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'automation_notice',
        dedupKey: row.id,
      });
      notified.push(userId);
    } catch (e) {
      // Один недоступный получатель не отменяет рассылку остальным.
      log.error('[automation/actions] notify failed', {
        userId,
        error: (e as Error).message,
      });
    }
  }
  return {
    createdTaskIds: [],
    notifiedUserIds: notified,
    error: notified.length === 0 ? 'ни одно уведомление не доставлено' : null,
  };
}

/**
 * `send_message` (`Р-Э4-13`) — робот пишет клиенту.
 *
 * Действие объявлено в каталоге и проходит проверку формы, но исполнение
 * появится вместе с разделом правил (PR-4), где человек увидит предупреждение
 * «сообщение уйдёт клиенту без участия менеджера». До тех пор правило с этим
 * действием честно записывает отказ в журнал, а не делает вид, что отправило.
 */
export function runSendMessage(): ActionOutcome {
  return { ...EMPTY, error: 'отправка сообщения клиенту правилом ещё не включена' };
}
