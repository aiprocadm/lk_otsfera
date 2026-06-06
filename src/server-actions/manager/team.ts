'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import {
  createAndAssignManager,
  deactivateAssignment,
  ManagerInviteError,
  type ManagerInviteErrorCode
} from '@/lib/services/manager/invite';

function readForm(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A leader may only touch orgs in their own company. */
async function orgInLeaderCompany(orgId: string, companyId: string | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { companyId: true } });
  return !!org && org.companyId === companyId;
}

const assignSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('existing'), organizationId: z.string().min(1), email: z.string().email() }),
  z.object({ mode: z.literal('new'), organizationId: z.string().min(1), email: z.string().email(), name: z.string().max(200).optional() })
]);

export type LeaderAssignResult =
  | { ok: true; inviteUrl: string | null; reactivated: boolean }
  | { ok: false; error: 'validation' | 'forbidden_org' | ManagerInviteErrorCode };

export async function leaderAssignManagerAction(formData: FormData): Promise<LeaderAssignResult> {
  const parsed = assignSchema.safeParse({
    mode: readForm(formData, 'mode'),
    organizationId: readForm(formData, 'organizationId'),
    email: readForm(formData, 'email'),
    name: readForm(formData, 'name')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!(await orgInLeaderCompany(parsed.data.organizationId, session.companyId))) {
    return { ok: false, error: 'forbidden_org' };
  }

  try {
    const result = await createAndAssignManager(prisma, parsed.data, session.sub);
    revalidatePath('/manager/team');
    return { ok: true, inviteUrl: result.inviteUrl, reactivated: result.reactivated };
  } catch (e) {
    if (e instanceof ManagerInviteError) return { ok: false, error: e.code };
    throw e;
  }
}

const deactivateSchema = z.object({ assignmentId: z.string().min(1) });

export type LeaderDeactivateResult = { ok: true } | { ok: false; error: 'validation' | 'forbidden_org' | 'not_found' };

export async function leaderDeactivateAssignmentAction(formData: FormData): Promise<LeaderDeactivateResult> {
  const parsed = deactivateSchema.safeParse({ assignmentId: readForm(formData, 'assignmentId') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  // Resolve the assignment's org first to enforce the company boundary.
  const row = await prisma.organizationManager.findUnique({
    where: { id: parsed.data.assignmentId },
    select: { organizationId: true }
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
