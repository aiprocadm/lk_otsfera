import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { bestEffort } from '@/lib/logging';
import { notifyDialogAssigned } from '@/lib/notifications/manager';
import { isDialogInScope } from './scope';

export type AssignDialogArgs = {
  dialogId: string;
  /** null — снять ответственного («Без ответственного»). */
  assigneeId: string | null;
};

export type AssignDialogResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'forbidden' | 'not_found' | 'invalid_assignee' };

export type AssignableStaff = { id: string; name: string };

/**
 * Сотрудники, на которых можно назначить диалог (У-206): контур ЦО своей
 * компании, только действующие. Заказчика и партнёра здесь быть не может —
 * диалог ведёт продавец.
 */
export async function listAssignableStaff(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<AssignableStaff[]> {
  if (!session.companyId) return [];
  const rows = await prisma.user.findMany({
    where: { companyId: session.companyId, role: { in: ['manager', 'leader'] }, isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  // Пустое имя в базе возможно — тогда в селекте показываем почту, иначе
  // сотрудник выглядел бы пустой строкой и выбрать его было бы нельзя.
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || r.email }));
}

/**
 * Назначить ответственного за диалог или снять его (`У-206`).
 *
 * Порядок: скоуп диалога → назначаемый существует, действует и в той же
 * компании → запись с отметками «кто и когда» → аудит → уведомление новому
 * ответственному (best-effort: оно не важнее самого назначения).
 *
 * Чужой диалог отвечает `not_found`, как и карточка: существование переписки
 * другой компании не раскрываем. Назначение на сотрудника чужой компании —
 * `invalid_assignee`, а не `not_found`: здесь скрывать нечего, и человеку
 * понятнее, что он выбрал не того.
 */
export async function assignDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  args: AssignDialogArgs
): Promise<AssignDialogResult> {
  if (!session.companyId) return { ok: false, error: 'forbidden' };

  const dialog = await prisma.messengerDialog.findUnique({
    where: { id: args.dialogId },
    select: { id: true, companyId: true, assigneeId: true },
  });
  if (!dialog || !isDialogInScope(session, dialog)) return { ok: false, error: 'not_found' };

  if (args.assigneeId !== null) {
    const assignee = await prisma.user.findFirst({
      where: {
        id: args.assigneeId,
        companyId: session.companyId,
        role: { in: ['manager', 'leader'] },
        isActive: true,
      },
      select: { id: true },
    });
    if (!assignee) return { ok: false, error: 'invalid_assignee' };
  }

  if (dialog.assigneeId === args.assigneeId) return { ok: true, changed: false };

  await prisma.messengerDialog.update({
    where: { id: dialog.id },
    data: {
      assigneeId: args.assigneeId,
      assignedAt: args.assigneeId ? new Date() : null,
      assignedById: args.assigneeId ? session.sub : null,
    },
  });

  // Назначение ответственного на НИЧЕЙ диалог забирает его в компанию
  // назначившего — то же правило первого ответившего (`Р-М-2`), только
  // раньше по времени. Без этого общая очередь (её видят сотрудники всех
  // компаний) показывала бы имя и рабочую почту сотрудника чужой компании,
  // а любой желающий мог бы переназначить чужой диалог на себя.
  // Условие в `where`: если компанию за это время проставил кто-то другой,
  // его решение не перетираем.
  if (dialog.companyId === null && args.assigneeId !== null) {
    const claimed = await prisma.messengerDialog.updateMany({
      where: { id: dialog.id, companyId: null },
      data: { companyId: session.companyId },
    });
    if (claimed.count > 0) {
      await recordAudit(prisma, {
        action: 'messenger_dialog_bound',
        entity: 'messenger_dialog',
        entityId: dialog.id,
        userId: session.sub,
        after: { companyId: session.companyId, reason: 'assign' },
      });
    }
  }

  await recordAudit(prisma, {
    action: 'dialog_assignee_changed',
    entity: 'messenger_dialog',
    entityId: dialog.id,
    userId: session.sub,
    after: { assigneeId: args.assigneeId, previousAssigneeId: dialog.assigneeId },
  });

  // Себе уведомление не шлём: человек только что сам нажал кнопку.
  if (args.assigneeId && args.assigneeId !== session.sub) {
    await notifyDialogAssigned(prisma, {
      assigneeId: args.assigneeId,
      dialogId: dialog.id,
    }).catch(bestEffort('[messengers/assign] notify assignee failed'));
  }

  return { ok: true, changed: true };
}

/** «Взять себе» — тот же путь, что и «Назначить», без выбора человека. */
export async function takeDialog(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { dialogId: string }
): Promise<AssignDialogResult> {
  return assignDialog(prisma, session, { dialogId: args.dialogId, assigneeId: session.sub });
}

/**
 * Правило первого ответившего для ответственного (`У-206`): сотрудник,
 * ответивший в диалог без ответственного, становится им.
 *
 * Условие стоит в `where`, а не в коде: между чтением диалога и этим шагом
 * ответственного мог назначить кто-то другой — чужое решение не перетираем.
 * Возвращает `true`, если назначение действительно произошло.
 */
export async function claimDialogOnFirstReply(
  prisma: PrismaClient,
  session: SessionPayload,
  dialogId: string
): Promise<boolean> {
  const claimed = await prisma.messengerDialog.updateMany({
    where: { id: dialogId, assigneeId: null },
    data: { assigneeId: session.sub, assignedAt: new Date(), assignedById: session.sub },
  });
  if (claimed.count === 0) return false;
  await recordAudit(prisma, {
    action: 'dialog_assignee_changed',
    entity: 'messenger_dialog',
    entityId: dialogId,
    userId: session.sub,
    after: { assigneeId: session.sub, previousAssigneeId: null, reason: 'first_reply' },
  });
  return true;
}
