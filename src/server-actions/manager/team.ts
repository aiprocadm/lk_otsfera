'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import {
  createAndAssignManager,
  deactivateAssignment,
  type ManagerInviteErrorCode,
} from '@/lib/services/manager/invite';
import { sendManagerInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

function readForm(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A leader may only touch orgs in their own company. */
async function orgInLeaderCompany(
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

const assignSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    organizationId: z.string().min(1),
    email: z.string().email(),
  }),
  z.object({
    mode: z.literal('new'),
    organizationId: z.string().min(1),
    email: z.string().email(),
    name: z.string().max(200).optional(),
  }),
]);

export type LeaderAssignResult =
  | { ok: true; inviteUrl: string | null; reactivated: boolean }
  | { ok: false; error: 'validation' | 'forbidden_org' | ManagerInviteErrorCode };

export async function leaderAssignManagerAction(formData: FormData): Promise<LeaderAssignResult> {
  const parsed = assignSchema.safeParse({
    mode: readForm(formData, 'mode'),
    organizationId: readForm(formData, 'organizationId'),
    email: readForm(formData, 'email'),
    name: readForm(formData, 'name'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!(await orgInLeaderCompany(parsed.data.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  // exactOptionalPropertyTypes: вход сервиса различает «ключа name нет» и «name = undefined».
  const input =
    parsed.data.mode === 'new'
      ? {
          mode: 'new' as const,
          organizationId: parsed.data.organizationId,
          email: parsed.data.email,
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        }
      : parsed.data;
  const result = await createAndAssignManager(prisma, input, session.sub);
  if (!result.ok) return { ok: false, error: result.error };

  // ФТ-10.1 (этап 4): leader-путь шлёт то же письмо, что и admin-путь.
  // Best-effort: сбой транспорта не роняет приглашение — inviteUrl остаётся
  // видимым в UI как фолбэк «Скопировать ссылку».
  if (result.inviteUrl !== null) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { name: true },
      });
      await sendManagerInviteEmail({
        to: parsed.data.email,
        organizationName: org?.name ?? 'организация',
        inviteUrl: result.inviteUrl,
        invitedByName: session.name ?? undefined,
      });
    } catch (e) {
      log.warn('[manager/team] send invite email failed', e);
    }
  }

  revalidatePath('/manager/team');
  return { ok: true, inviteUrl: result.inviteUrl, reactivated: result.reactivated };
}

const deactivateSchema = z.object({ assignmentId: z.string().min(1) });

export type LeaderDeactivateResult =
  { ok: true } | { ok: false; error: 'validation' | 'forbidden_org' | 'not_found' };

export async function leaderDeactivateAssignmentAction(
  formData: FormData
): Promise<LeaderDeactivateResult> {
  const parsed = deactivateSchema.safeParse({ assignmentId: readForm(formData, 'assignmentId') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  // Resolve the assignment's org first to enforce the company boundary.
  const row = await prisma.organizationManager.findUnique({
    where: { id: parsed.data.assignmentId },
    select: { organizationId: true },
  });
  if (!row) return { ok: false, error: 'not_found' };
  if (!(await orgInLeaderCompany(row.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  const result = await deactivateAssignment(prisma, parsed.data.assignmentId, session.sub);
  if (!result.ok) return { ok: false, error: 'not_found' };
  revalidatePath('/manager/team');
  return { ok: true };
}
