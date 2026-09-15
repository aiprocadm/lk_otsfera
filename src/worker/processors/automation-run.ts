import type { Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db/prisma';
import { log } from '@/lib/logging';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import {
  actionsSchema,
  runCreateTask,
  runNotify,
  runSendMessage,
  type ActionOutcome,
} from '@/lib/automation/actions';
import type { AutomationEventPayload } from '@/lib/automation/conditions';

/**
 * Исполнение правила автоматизации (`У-223`).
 *
 * Три обязательства, каждое со своим стражем:
 *
 * 1. **Одно событие — одно исполнение.** Запись `AutomationRun` с уникальным
 *    ключом `(ruleId, eventId)` создаётся ПЕРЕД действиями; конфликт `P2002`
 *    означает «это событие уже отработано» и джоб завершается молча. Канон —
 *    `SlaEscalation` в `sla-escalation.ts`. Без этого повторная доставка
 *    задачи очередью (ретрай, перезапуск воркера) создала бы вторую задачу.
 * 2. **Сбой действия не валит бизнес-операцию и не валит джоб.** Операция
 *    давно совершилась в другом процессе; здесь остаётся записать причину в
 *    журнал, чтобы человек её увидел (§3 fail-open).
 * 3. **Сломанное правило само себя выключает и говорит об этом.** Правило,
 *    которое ссылается на удалённый статус или хранит нечитаемые действия,
 *    деактивируется, а администратору и руководителям уходит
 *    `automation_failed` (§9 пакета). Молчащий робот хуже отсутствующего.
 */

export type AutomationRunPayload = {
  ruleId: string;
  eventId: string;
  companyId: string;
  payload: AutomationEventPayload;
};

export async function runAutomationRule(
  prisma: PrismaClient,
  job: AutomationRunPayload
): Promise<{ status: 'ok' | 'failed' | 'skipped'; reason?: string }> {
  const rule = await prisma.automationRule.findUnique({
    where: { id: job.ruleId },
    select: {
      id: true,
      name: true,
      companyId: true,
      isActive: true,
      actions: true,
      createdById: true,
      updatedBy: true,
    },
  });
  if (!rule) return { status: 'skipped', reason: 'правило удалено' };
  // Правило могли выключить, пока событие лежало в очереди.
  if (!rule.isActive) return { status: 'skipped', reason: 'правило выключено' };
  // Событие чужой компании до правила дойти не должно — но если дошло, это
  // граница изоляции, и молчать нельзя.
  if (rule.companyId !== job.companyId) {
    log.error('[automation/run] событие чужой компании — правило не исполнено', {
      ruleId: rule.id,
    });
    return { status: 'skipped', reason: 'событие чужой компании' };
  }

  // Заявка на исполнение — ДО действий. Повтор отсекается уникальным ключом.
  try {
    await prisma.automationRun.create({
      data: {
        ruleId: rule.id,
        eventId: job.eventId,
        companyId: job.companyId,
        status: 'ok',
      },
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'P2002') {
      return { status: 'skipped', reason: 'событие уже отработано' };
    }
    throw e;
  }

  const parsed = actionsSchema.safeParse(rule.actions);
  if (!parsed.success) {
    await finish(prisma, job, {
      createdTaskIds: [],
      notifiedUserIds: [],
      error: 'действия правила не читаются',
    });
    await deactivate(prisma, rule.id, rule.name, job.companyId, 'действия правила не читаются');
    return { status: 'failed', reason: 'действия правила не читаются' };
  }

  // Автор задач робота — человек, включивший правило (`Р-Э4-4`). Системную
  // сессию не подделываем, а без автора задачу создать нельзя.
  const authorId = rule.createdById ?? rule.updatedBy;
  const merged: ActionOutcome = { createdTaskIds: [], notifiedUserIds: [], error: null };
  const errors: string[] = [];

  for (const action of parsed.data) {
    try {
      const outcome = await runOne(prisma, {
        action,
        companyId: job.companyId,
        ruleId: rule.id,
        ruleName: rule.name,
        authorId,
        payload: job.payload,
      });
      merged.createdTaskIds.push(...outcome.createdTaskIds);
      merged.notifiedUserIds.push(...outcome.notifiedUserIds);
      if (outcome.error) errors.push(outcome.error);
    } catch (e) {
      // Сбой одного действия не отменяет соседние и не роняет джоб.
      const reason = e instanceof Error ? e.message : String(e);
      errors.push(reason);
      log.error('[automation/run] действие правила упало', { ruleId: rule.id, error: reason });
    }
  }

  const error = errors.length > 0 ? errors.join('; ') : null;
  await finish(prisma, job, { ...merged, error });
  return error ? { status: 'failed', reason: error } : { status: 'ok' };
}

async function runOne(
  prisma: PrismaClient,
  args: {
    action: (typeof actionsSchema)['_output'][number];
    companyId: string;
    ruleId: string;
    ruleName: string;
    authorId: string | null;
    payload: AutomationEventPayload;
  }
): Promise<ActionOutcome> {
  const { action } = args;
  if (action.kind === 'notify') {
    return runNotify(prisma, {
      action,
      companyId: args.companyId,
      ruleName: args.ruleName,
      payload: args.payload,
    });
  }
  if (action.kind === 'send_message') return runSendMessage();
  if (!args.authorId) {
    // Встроенное правило включают галочкой, и включивший записывается автором.
    // Пустой автор означает, что строку завели мимо интерфейса.
    return {
      createdTaskIds: [],
      notifiedUserIds: [],
      error: 'у правила нет автора — некому записать в создатели задачи',
    };
  }
  return runCreateTask(prisma, {
    action,
    companyId: args.companyId,
    ruleId: args.ruleId,
    authorId: args.authorId,
    payload: args.payload,
  });
}

async function finish(
  prisma: PrismaClient,
  job: AutomationRunPayload,
  outcome: ActionOutcome
): Promise<void> {
  await prisma.automationRun.update({
    where: { ruleId_eventId: { ruleId: job.ruleId, eventId: job.eventId } },
    data: {
      status: outcome.error ? 'failed' : 'ok',
      error: outcome.error,
      createdTaskIds: outcome.createdTaskIds,
      notifiedUserIds: outcome.notifiedUserIds,
    },
  });
}

/** Сломанное правило выключается и сообщает о себе (§9 пакета). */
async function deactivate(
  prisma: PrismaClient,
  ruleId: string,
  ruleName: string,
  companyId: string,
  reason: string
): Promise<void> {
  try {
    await prisma.automationRule.update({ where: { id: ruleId }, data: { isActive: false } });
    const recipients = await prisma.user.findMany({
      where: { isActive: true, OR: [{ companyId, role: 'leader' }, { role: 'admin' }] },
      select: { id: true },
    });
    const title = 'Правило автоматизации выключено';
    const body = `Правило «${ruleName}» отключено: ${reason}.`;
    for (const r of recipients) {
      const row = await createNotification({
        userId: r.id,
        type: 'automation_failed',
        title,
        body,
        meta: { ruleId },
      });
      await deliverNotificationToUser({
        userId: r.id,
        title,
        body,
        type: 'automation_failed',
        dedupKey: row.id,
      });
    }
  } catch (e) {
    log.error('[automation/run] не удалось выключить правило', {
      ruleId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

export function automationRunProcessor(db: PrismaClient = defaultPrisma) {
  return async (job: Job<AutomationRunPayload>): Promise<void> => {
    const res = await runAutomationRule(db, job.data);
    if (res.status !== 'ok') {
      log.info('[automation/run] правило не выполнено', {
        ruleId: job.data.ruleId,
        status: res.status,
        reason: res.reason,
      });
    }
  };
}
