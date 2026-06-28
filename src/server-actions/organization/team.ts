'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireOrganizationAdminOrLeader } from '@/lib/auth/requireRole';
import { isOrgAdmin } from '@/lib/auth/organizationPolicy';
import {
  inviteMember,
  updateMemberRole,
  deactivateMember,
  reactivateMember,
  type OrgMemberErrorCode,
  type InviteMemberResult
} from '@/lib/services/organization/team';
import { sendOrgInviteEmail } from '@/lib/email/send';

type Success<T> = T extends void ? { ok: true } : { ok: true } & T;
type Failure = {
  ok: false;
  error: 'validation' | 'forbidden' | OrgMemberErrorCode;
  details?: unknown;
};
export type ActionResult<T = void> = Success<T> | Failure;

const inviteSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(200),
  roleInOrg: z.enum(['admin', 'leader', 'member'])
});

const roleSchema = z.object({
  organizationId: z.string().min(1),
  orgUserId: z.string().min(1),
  newRole: z.enum(['admin', 'leader', 'member'])
});

const targetSchema = z.object({
  organizationId: z.string().min(1),
  orgUserId: z.string().min(1)
});

function readFormValue(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export async function inviteOrgMemberAction(
  formData: FormData
): Promise<
  ActionResult<{
    user: InviteMemberResult['user'];
    inviteUrl: string | null;
    alreadyHasPassword: boolean;
  }>
> {
  const parsed = inviteSchema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    email: readFormValue(formData, 'email'),
    name: readFormValue(formData, 'name'),
    roleInOrg: readFormValue(formData, 'roleInOrg') || 'member'
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireOrganizationAdminOrLeader(parsed.data.organizationId);
  const actorRole = isOrgAdmin(session, parsed.data.organizationId) ? 'admin' : 'leader';

  const res = await inviteMember(
    prisma,
    parsed.data,
    session.sub,
    { source: 'organization' },
    actorRole
  );
  if (!res.ok) return { ok: false, error: res.error };

  // Send invite email best-effort. send() returns 'skipped' silently when
  // EMAIL_ENABLED!=true or RESEND_API_KEY is missing, but a live transport
  // can still reject — that must not fail the action: the invite is already
  // created and inviteUrl is returned for the "Copy link" fallback.
  if (res.inviteUrl !== null) {
    try {
      const org = await prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { name: true }
      });
      await sendOrgInviteEmail({
        to: parsed.data.email,
        organizationName: org?.name ?? 'организация',
        inviteUrl: res.inviteUrl,
        invitedByName: session.name ?? undefined
      });
    } catch (e) {
      console.warn('[organization/team] send invite email failed', e);
    }
  }

  revalidatePath('/organization/team');
  return {
    ok: true,
    user: res.user,
    inviteUrl: res.inviteUrl,
    alreadyHasPassword: res.alreadyHasPassword
  };
}

export async function updateOrgMemberRoleAction(formData: FormData): Promise<ActionResult> {
  const parsed = roleSchema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    orgUserId: readFormValue(formData, 'orgUserId'),
    newRole: readFormValue(formData, 'newRole')
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireOrganizationAdminOrLeader(parsed.data.organizationId);
  const actorRole = isOrgAdmin(session, parsed.data.organizationId) ? 'admin' : 'leader';

  const res = await updateMemberRole(prisma, parsed.data.organizationId, parsed.data.orgUserId, parsed.data.newRole, session.sub, actorRole);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/organization/team');
  return { ok: true };
}

export async function deactivateOrgMemberAction(formData: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    orgUserId: readFormValue(formData, 'orgUserId')
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireOrganizationAdminOrLeader(parsed.data.organizationId);
  const actorRole = isOrgAdmin(session, parsed.data.organizationId) ? 'admin' : 'leader';

  const res = await deactivateMember(prisma, parsed.data.organizationId, parsed.data.orgUserId, session.sub, actorRole);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/organization/team');
  return { ok: true };
}

export async function reactivateOrgMemberAction(formData: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    orgUserId: readFormValue(formData, 'orgUserId')
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireOrganizationAdminOrLeader(parsed.data.organizationId);
  const actorRole = isOrgAdmin(session, parsed.data.organizationId) ? 'admin' : 'leader';

  const res = await reactivateMember(prisma, parsed.data.organizationId, parsed.data.orgUserId, session.sub, actorRole);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/organization/team');
  return { ok: true };
}

// ----- Form-compatible thin wrappers ---------------------------------------
// React's <form action={fn}> types accept only void-returning actions. The
// typed Action functions above are kept for imperative client-side use
// (where we want structured error feedback). Wrappers below discard the
// result so they can be wired directly to <form action>. Errors still
// trigger revalidatePath, so the UI re-renders and stale-state regressions
// are caught visually — though without inline error text.

export async function updateOrgMemberRoleFormAction(formData: FormData): Promise<void> {
  const result = await updateOrgMemberRoleAction(formData);
  if (!result.ok) console.warn('[organization/team] updateOrgMemberRoleFormAction failed', result);
}

export async function deactivateOrgMemberFormAction(formData: FormData): Promise<void> {
  const result = await deactivateOrgMemberAction(formData);
  if (!result.ok) console.warn('[organization/team] deactivateOrgMemberFormAction failed', result);
}

export async function reactivateOrgMemberFormAction(formData: FormData): Promise<void> {
  const result = await reactivateOrgMemberAction(formData);
  if (!result.ok) console.warn('[organization/team] reactivateOrgMemberFormAction failed', result);
}
