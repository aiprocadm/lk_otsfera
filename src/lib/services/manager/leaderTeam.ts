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

export type AssignManagerAsLeaderResult =
  | { ok: true; inviteUrl: string | null; reactivated: boolean }
  | { ok: false; error: 'forbidden_org' | ManagerInviteErrorCode };

export type DeactivateAssignmentAsLeaderResult =
  { ok: true } | { ok: false; error: 'forbidden_org' | 'not_found' };

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
