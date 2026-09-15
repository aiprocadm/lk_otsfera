import type { PrismaClient } from '@prisma/client';
import { createNotification, deliverNotificationToUser } from '@/lib/notifications';
import { INTAKE_BREACH_HOURS } from '@/lib/services/intake/list';
import { DIALOG_STATUS } from '@/lib/services/messengers/dialogStatus';
import { MESSENGER_LABELS, isMessengerChannel } from '@/lib/services/messengers/channels';
import { log } from '@/lib/logging';
import { emitAutomationEvent } from '@/lib/automation/dispatch';

/**
 * Этап 7 (§4.4, ФТ-8.5, PR-3) — SLA-эскалация Intake: единицы БЕЗ
 * ответственного, ждущие дольше `Company.slaResponseHours` (единицы общей
 * очереди без компании — дефолт-порог), эскалируются руководителям компании
 * (общая очередь — руководителям всех компаний: она видна в каждом Intake).
 * Решение §10-2 спеки: ОДНО уведомление на единицу, без повторов — дедуп
 * через журнал `SlaEscalation` (@@unique[sourceType,sourceId] + P2002-skip,
 * образец CertificateReminder). Идемпотентно; ошибка доставки конкретному
 * получателю логируется и не валит джоб.
 */

const BATCH_LIMIT = 200;
const ESCALATION_URL = '/leader/intake';

type Unit = {
  sourceType: 'client_request' | 'enrollment' | 'inbound' | 'call' | 'dialog';
  sourceId: string;
  companyId: string | null;
  createdAt: Date;
  label: string;
  /** Куда вести руководителя; по умолчанию — очередь «Входящие в работу». */
  url?: string;
};

type CompanyInfo = {
  id: string;
  slaResponseHours: number;
  /** `У-225`: на какой день просрочки задачи сообщать руководителю; `0` — не сообщать. */
  taskOverdueEscalationDays: number;
  leaders: string[];
};

async function loadCompanies(prisma: PrismaClient): Promise<CompanyInfo[]> {
  const companies = await prisma.company.findMany({
    select: {
      id: true,
      slaResponseHours: true,
      // `У-225`: на какой день просрочки задачи сообщать руководителю.
      taskOverdueEscalationDays: true,
      users: {
        where: { role: 'leader', isActive: true },
        select: { id: true },
      },
    },
  });
  return companies.map((c) => ({
    id: c.id,
    slaResponseHours: c.slaResponseHours,
    taskOverdueEscalationDays: c.taskOverdueEscalationDays,
    leaders: c.users.map((u) => u.id),
  }));
}

/** Неразобранные единицы без ответственного (адм-широкий срез — джоб платформенный). */
async function loadUnassignedUnits(prisma: PrismaClient): Promise<Unit[]> {
  const [requests, enrollments, inbound, dialogs, calls] = await Promise.all([
    prisma.clientRequest.findMany({
      where: { status: 'submitted' },
      select: {
        id: true,
        createdAt: true,
        companyName: true,
        subject: true,
        organization: { select: { companyId: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.enrollmentRequest.findMany({
      where: { status: 'pending', claimedByUserId: null },
      select: {
        id: true,
        createdAt: true,
        organization: { select: { name: true, companyId: true } },
        // `У-36`: направление живёт в позициях — для подписи хватит первой.
        items: { select: { direction: { select: { name: true } } }, take: 1 },
        legacyCourseTitle: true,
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.inboundMessage.findMany({
      where: { status: 'unresolved', claimedByUserId: null },
      select: {
        id: true,
        createdAt: true,
        companyId: true,
        senderDisplay: true,
        senderRef: true,
        subject: true,
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
    // У-207: диалог, который ждёт ответа сотрудника дольше SLA. В отличие от
    // остальных источников ответственный тут не важен: диалог может быть
    // назначен и всё равно остаться без ответа — именно это руководитель и
    // должен увидеть.
    prisma.messengerDialog.findMany({
      where: { status: DIALOG_STATUS.waitingStaff, waitingSince: { not: null } },
      select: {
        id: true,
        waitingSince: true,
        companyId: true,
        channel: true,
        peerDisplay: true,
        peerRef: true,
        contact: { select: { name: true } },
      },
      orderBy: { waitingSince: 'asc' },
      take: BATCH_LIMIT,
    }),
    prisma.call.findMany({
      where: {
        direction: 'inbound',
        resolvedOrgId: null,
        contactId: null,
        intakeClosedAt: null,
        lead: null,
        claimedByUserId: null,
      },
      select: { id: true, createdAt: true, companyId: true, callerNumber: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_LIMIT,
    }),
  ]);

  const units: Unit[] = [];
  for (const r of requests) {
    units.push({
      sourceType: 'client_request',
      sourceId: r.id,
      companyId: r.organization?.companyId ?? null,
      createdAt: r.createdAt,
      label: `заявка клиента «${r.subject}» (${r.companyName})`,
    });
  }
  for (const e of enrollments) {
    const direction = e.items[0]?.direction?.name ?? e.legacyCourseTitle ?? 'обучение';
    units.push({
      sourceType: 'enrollment',
      sourceId: e.id,
      companyId: e.organization?.companyId ?? null,
      createdAt: e.createdAt,
      label: `заявка на обучение «${direction}»${e.organization ? ` (${e.organization.name})` : ''}`,
    });
  }
  for (const m of inbound) {
    units.push({
      sourceType: 'inbound',
      sourceId: m.id,
      companyId: m.companyId,
      createdAt: m.createdAt,
      label: `обращение от ${m.senderDisplay?.trim() || m.senderRef}${m.subject ? `: «${m.subject}»` : ''}`,
    });
  }
  for (const d of dialogs) {
    // `waitingSince` в выборке заведомо не null (условие `where`), но тип его
    // не знает — берём запасной вариант, чтобы не писать non-null assertion.
    const since = d.waitingSince ?? new Date();
    const channelLabel = isMessengerChannel(d.channel) ? MESSENGER_LABELS[d.channel] : d.channel;
    const who = d.contact?.name?.trim() || d.peerDisplay?.trim() || d.peerRef;
    units.push({
      sourceType: 'dialog',
      // Ключ дедупа — диалог + начало ЭТОГО ожидания: одна эскалация на один
      // неотвеченный вопрос. Иначе диалог, однажды просроченный, больше
      // никогда бы не позвал руководителя (уникальность журнала — на пару
      // «источник + id»), и второе такое же молчание прошло бы незаметно.
      sourceId: `${d.id}:${since.toISOString()}`,
      companyId: d.companyId,
      createdAt: since,
      label: `диалог в ${channelLabel} с ${who}`,
      // Ссылка ведёт в саму переписку, а не в общую очередь: диалог там не
      // лежит, и руководитель искал бы его вручную.
      url: `/manager/messengers/${d.id}`,
    });
  }
  for (const c of calls) {
    units.push({
      sourceType: 'call',
      sourceId: c.id,
      companyId: c.companyId,
      createdAt: c.createdAt,
      label: `входящий звонок с ${c.callerNumber}`,
    });
  }
  return units;
}

export async function runSlaEscalation(
  prisma: PrismaClient,
  now: Date
): Promise<{ escalated: number }> {
  const companies = await loadCompanies(prisma);
  const byCompanyId = new Map(companies.map((c) => [c.id, c]));
  const allLeaders = [...new Set(companies.flatMap((c) => c.leaders))];

  const units = await loadUnassignedUnits(prisma);

  let escalated = 0;
  for (const unit of units) {
    const company = unit.companyId ? byCompanyId.get(unit.companyId) : undefined;
    const thresholdHours = company?.slaResponseHours ?? INTAKE_BREACH_HOURS;
    const ageHours = (now.getTime() - unit.createdAt.getTime()) / 3_600_000;
    if (ageHours <= thresholdHours) continue;

    const recipients = company ? company.leaders : allLeaders;
    if (recipients.length === 0) continue;

    // Дедуп: одна эскалация на единицу за всю её жизнь (решение §10-2).
    try {
      await prisma.slaEscalation.create({
        data: { sourceType: unit.sourceType, sourceId: unit.sourceId, companyId: unit.companyId },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') continue;
      throw e;
    }

    const waitedHours = Math.floor(ageHours);

    // `У-223`: клиент ждёт ответа дольше SLA — событие для правил
    // автоматизации. Испускается ПОСЛЕ дедуп-записи: она и означает «просрочка
    // признана», а до неё событие могло бы повториться на каждом прогоне.
    //
    // Только для переписки: у прочих источников Intake это «никто не взял в
    // работу», а не «клиент не получил ответа» — разные события, и смешивать
    // их в одном триггере значило бы запускать правило не на то.
    if (unit.sourceType === 'dialog') {
      await emitAutomationEvent(prisma, {
        trigger: 'dialog_waiting_staff_overdue',
        companyId: unit.companyId,
        payload: {
          // `sourceId` у диалога составной — `<id диалога>:<начало ожидания>`:
          // одна эскалация на один неотвеченный вопрос, а не на диалог целиком.
          dialogId: unit.sourceId.split(':')[0] ?? unit.sourceId,
          waitedHours,
          thresholdHours,
          label: unit.label,
          responsibleManagerId: null,
        },
      });
    }

    const unitUrl = unit.url ?? ESCALATION_URL;
    // У диалога ответственный может быть назначен — эскалация про отсутствие
    // ОТВЕТА, а не про отсутствие хозяина. Общий текст «Без ответственного»
    // отправлял бы руководителя искать свободный диалог, которого нет.
    const isDialog = unit.sourceType === 'dialog';
    const title = isDialog ? 'SLA: клиент ждёт ответа' : 'SLA: входящее без реакции';
    const body = isDialog
      ? `Нет ответа клиенту ${waitedHours} ч (порог ${thresholdHours} ч): ${unit.label}.`
      : `Без ответственного ${waitedHours} ч (порог ${thresholdHours} ч): ${unit.label}.`;

    for (const userId of recipients) {
      try {
        const row = await createNotification({
          userId,
          type: 'sla_escalation',
          title,
          body,
          meta: { sourceType: unit.sourceType, sourceId: unit.sourceId, url: unitUrl },
        });
        await deliverNotificationToUser({
          userId,
          title,
          body,
          type: 'sla_escalation',
          url: unitUrl,
          dedupKey: row.id,
        });
      } catch (err) {
        log.error('[sla-escalation] notify failed', {
          userId,
          sourceType: unit.sourceType,
          sourceId: unit.sourceId,
          error: (err as Error).message,
        });
      }
    }

    escalated += 1;
  }

  return { escalated };
}

/**
 * Просроченные задачи (`У-225`).
 *
 * Два уведомления в РАЗНЫЕ дни, и потому два отдельных поля-claim:
 *  - `overdueNotifiedAt` — исполнителям в день просрочки;
 *  - `overdueEscalatedAt` — руководителям на N-й день (`Company.taskOverdueEscalationDays`).
 *
 * Одним полем это не выражается, а считать «который раз» по датам на каждом
 * прогоне значит читать всю таблицу задач — ровно то, от чего уходили в прогоне
 * сопровождения №26.
 *
 * Claim АТОМАРНЫЙ: `updateMany` по `null` возвращает 0, если строку уже занял
 * параллельный прогон, — тогда уведомление не шлётся. Канон — `dueSoonNotifiedAt`
 * в `task-due-soon.ts`.
 */
export async function runTaskOverdue(
  prisma: PrismaClient,
  now: Date
): Promise<{ notified: number; escalated: number }> {
  const companies = await loadCompanies(prisma);
  let notified = 0;
  let escalated = 0;

  for (const company of companies) {
    notified += await notifyOverdueAssignees(prisma, company, now);
    escalated += await escalateOverdueToLeaders(prisma, company, now);
  }
  return { notified, escalated };
}

/** Сколько задач разбираем за один заход: ночной прогон не должен расти с базой. */
const TASK_BATCH = 200;

/** Шаг 1: исполнителю в день просрочки. */
async function notifyOverdueAssignees(
  prisma: PrismaClient,
  company: CompanyInfo,
  now: Date
): Promise<number> {
  const tasks = await prisma.task.findMany({
    where: {
      companyId: company.id,
      status: { not: 'done' },
      dueDate: { lt: now },
      overdueNotifiedAt: null,
    },
    orderBy: { dueDate: 'asc' },
    take: TASK_BATCH,
    select: {
      id: true,
      title: true,
      dueDate: true,
      createdById: true,
      assignees: { select: { userId: true } },
    },
  });

  let sent = 0;
  for (const task of tasks) {
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, overdueNotifiedAt: null },
      data: { overdueNotifiedAt: now },
    });
    if (claimed.count === 0) continue;

    // Исполнителям, а если их нет — создателю: задача без адресата не должна
    // молча остаться просроченной навсегда.
    const recipients =
      task.assignees.length > 0 ? task.assignees.map((a) => a.userId) : [task.createdById];
    const title = 'Задача просрочена';
    const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '—';
    const body = `«${task.title}»: срок был ${due}.`;
    await notifyTask(recipients, task.id, title, body);
    sent += 1;
  }
  return sent;
}

/** Шаг 2: руководителю на N-й день просрочки. */
async function escalateOverdueToLeaders(
  prisma: PrismaClient,
  company: CompanyInfo,
  now: Date
): Promise<number> {
  const days = company.taskOverdueEscalationDays;
  // `0` — компания выключила эскалацию. Руководителей нет — сообщать некому.
  if (days <= 0 || company.leaders.length === 0) return 0;

  const deadline = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const tasks = await prisma.task.findMany({
    where: {
      companyId: company.id,
      status: { not: 'done' },
      dueDate: { lt: deadline },
      overdueEscalatedAt: null,
    },
    orderBy: { dueDate: 'asc' },
    take: TASK_BATCH,
    select: { id: true, title: true, dueDate: true },
  });

  let sent = 0;
  for (const task of tasks) {
    const claimed = await prisma.task.updateMany({
      where: { id: task.id, overdueEscalatedAt: null },
      data: { overdueEscalatedAt: now },
    });
    if (claimed.count === 0) continue;

    const due = task.dueDate ? new Date(task.dueDate).toLocaleDateString('ru-RU') : '—';
    await notifyTask(
      company.leaders,
      task.id,
      'Задача просрочена больше нормы',
      `«${task.title}»: срок был ${due}, прошло больше ${days} дн.`
    );
    sent += 1;
  }
  return sent;
}

/** Общая доставка: сбой одного получателя не отменяет остальных (§3 fail-open). */
async function notifyTask(
  userIds: string[],
  taskId: string,
  title: string,
  body: string
): Promise<void> {
  const url = `/manager/tasks/${taskId}`;
  for (const userId of [...new Set(userIds)]) {
    try {
      const row = await createNotification({
        userId,
        type: 'task_overdue',
        title,
        body,
        meta: { taskId, url },
      });
      await deliverNotificationToUser({
        userId,
        title,
        body,
        type: 'task_overdue',
        url,
        dedupKey: row.id,
      });
    } catch (err) {
      log.error('[sla-escalation] task_overdue notify failed', {
        taskId,
        userId,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * BullMQ wrapper, вызывается воркером по расписанию.
 *
 * Оба разбора в одном заходе: «никто не взял входящее» и «задача просрочена» —
 * разные события, но обе проверки ночные и обе про то, что работа стоит. Второе
 * расписание ради этого не заводим.
 */
export async function slaEscalationProcessor(): Promise<{
  escalated: number;
  tasksNotified: number;
  tasksEscalated: number;
}> {
  const { prisma } = await import('@/lib/db/prisma');
  const now = new Date();
  const intake = await runSlaEscalation(prisma, now);
  const tasks = await runTaskOverdue(prisma, now);
  return {
    escalated: intake.escalated,
    tasksNotified: tasks.notified,
    tasksEscalated: tasks.escalated,
  };
}
