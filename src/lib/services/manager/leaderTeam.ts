import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import {
  createAndAssignManager,
  deactivateAssignment,
  type CreateAndAssignManagerInput,
  type ManagerInviteErrorCode,
} from '@/lib/services/manager/invite';
import { sendManagerInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';
import { recordAudit } from '@/lib/auth/audit';

export type AssignManagerAsLeaderResult =
  | { ok: true; inviteUrl: string | null; reactivated: boolean }
  | { ok: false; error: 'forbidden_org' | ManagerInviteErrorCode };

export type DeactivateAssignmentAsLeaderResult =
  { ok: true } | { ok: false; error: 'forbidden_org' | 'not_found' };

export type TransferOrganizationResult =
  | { ok: true; ordersMoved: number }
  | {
      ok: false;
      error:
        | 'forbidden_org'
        | 'transfer_target_invalid'
        | 'transfer_same_manager'
        | 'transfer_not_assigned';
    };

/** A leader may only touch orgs in their own company. */
async function orgInLeaderCompany(
  prisma: PrismaClient,
  orgId: string,
  companyId: string | null | undefined
): Promise<boolean> {
  if (!companyId) return false;
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { companyId: true },
  });
  return !!org && org.companyId === companyId;
}

/**
 * Назначение менеджера на организацию руководителем (ФТ-10.1, этап 4).
 * C8: организация обязана принадлежать компании руководителя — гейт стоит ДО
 * общего `createAndAssignManager`, который сам про роль вызывающего не знает.
 *
 * Письмо-приглашение — best-effort: сбой транспорта не роняет приглашение,
 * `inviteUrl` остаётся видимым в UI как фолбэк «Скопировать ссылку».
 */
export async function assignManagerAsLeader(
  prisma: PrismaClient,
  session: SessionPayload,
  input: CreateAndAssignManagerInput
): Promise<AssignManagerAsLeaderResult> {
  if (!(await orgInLeaderCompany(prisma, input.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  const result = await createAndAssignManager(prisma, input, session.sub);
  if (!result.ok) return { ok: false, error: result.error };

  // ФТ-10.1 (этап 4): leader-путь шлёт то же письмо, что и admin-путь.
  if (result.inviteUrl !== null) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: input.organizationId },
        select: { name: true },
      });
      await sendManagerInviteEmail({
        to: input.email,
        organizationName: org?.name ?? 'организация',
        inviteUrl: result.inviteUrl,
        invitedByName: session.name ?? undefined,
      });
    } catch (e) {
      log.warn('[manager/team] send invite email failed', e);
    }
  }

  return { ok: true, inviteUrl: result.inviteUrl, reactivated: result.reactivated };
}

/**
 * Снятие менеджера с организации руководителем. Организация назначения
 * резолвится первой — иначе C8-границу не на чем проверить (в сам
 * `deactivateAssignment` компания не передаётся: он общий с admin-путём).
 */
export async function deactivateAssignmentAsLeader(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { assignmentId: string }
): Promise<DeactivateAssignmentAsLeaderResult> {
  const row = await prisma.organizationManager.findUnique({
    where: { id: args.assignmentId },
    select: { organizationId: true },
  });
  if (!row) return { ok: false, error: 'not_found' };
  if (!(await orgInLeaderCompany(prisma, row.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  const result = await deactivateAssignment(prisma, args.assignmentId, session.sub);
  if (!result.ok) return { ok: false, error: 'not_found' };
  return { ok: true };
}

const TERMINAL_EXEC = ['completed', 'cancelled'] as const;

/**
 * Перевод организации другому менеджеру из «Команды» руководителя (`У-346`,
 * макет 2). Одной транзакцией: прежнее закрепление снимается, новое
 * появляется (или возвращается в работу), а **открытые** заказы организации,
 * которые вёл прежний менеджер, уходят новому — иначе организация «у нового»,
 * а её текущие заказы молча остаются у прежнего. Закрытые заказы не трогаем:
 * это история и основа расчётов прежнего менеджера.
 *
 * C8: организация и оба менеджера — из компании руководителя. Новым
 * ответственным может быть только рядовой менеджер (как и в назначении:
 * `createAndAssignManager` принимает лишь `role='manager'`).
 */
export async function transferOrganizationAsLeader(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { organizationId: string; fromUserId: string; toUserId: string }
): Promise<TransferOrganizationResult> {
  const { organizationId, fromUserId, toUserId } = args;
  if (!(await orgInLeaderCompany(prisma, organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }
  if (fromUserId === toUserId) return { ok: false, error: 'transfer_same_manager' };

  const target = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { role: true, companyId: true, isActive: true },
  });
  if (
    !target ||
    target.role !== 'manager' ||
    !target.isActive ||
    target.companyId !== session.companyId
  ) {
    return { ok: false, error: 'transfer_target_invalid' };
  }

  return prisma.$transaction(async (tx) => {
    const from = await tx.organizationManager.findUnique({
      where: { organizationId_userId: { organizationId, userId: fromUserId } },
      select: { id: true, isActive: true },
    });
    if (!from?.isActive) return { ok: false as const, error: 'transfer_not_assigned' as const };

    const now = new Date();
    await tx.organizationManager.update({
      where: { id: from.id },
      data: { isActive: false, deactivatedAt: now },
    });
    await tx.organizationManager.upsert({
      where: { organizationId_userId: { organizationId, userId: toUserId } },
      create: { organizationId, userId: toUserId, isActive: true, assignedBy: session.sub },
      update: { isActive: true, deactivatedAt: null, assignedAt: now, assignedBy: session.sub },
    });
    const moved = await tx.order.updateMany({
      where: {
        organizationId,
        managerId: fromUserId,
        executionStatus: { notIn: [...TERMINAL_EXEC] },
      },
      data: { managerId: toUserId },
    });
    await recordAudit(tx, {
      userId: session.sub,
      action: 'organization_transferred',
      entity: 'organization',
      entityId: organizationId,
      after: { fromUserId, toUserId, ordersMoved: moved.count },
    });
    return { ok: true as const, ordersMoved: moved.count };
  });
}
