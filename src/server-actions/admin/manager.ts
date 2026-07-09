'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  createAndAssignManager,
  deactivateAssignment,
  reactivateAssignment,
  type ManagerInviteErrorCode
} from '@/lib/services/manager/invite';
import { sendManagerInviteEmail } from '@/lib/email/send';
import { setManagerRole } from '@/lib/services/admin/managerRole';
import { assignOrderManager } from '@/lib/services/manager/distribution';
import { log } from '@/lib/logging';

export type AssignOrInviteManagerActionError =
  | 'validation'
  | ManagerInviteErrorCode;

export type AssignOrInviteManagerActionResult =
  | {
      ok: true;
      user: { id: string; email: string };
      inviteUrl: string | null;
      alreadyHasPassword: boolean;
      reactivated: boolean;
    }
  | { ok: false; error: AssignOrInviteManagerActionError; details?: unknown };

const assignOrInviteSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('existing'),
    organizationId: z.string().min(1),
    email: z.string().email()
  }),
  z.object({
    mode: z.literal('new'),
    organizationId: z.string().min(1),
    email: z.string().email(),
    name: z.string().max(200).optional()
  })
]);

function readForm(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function assignOrInviteManagerAction(
  formData: FormData
): Promise<AssignOrInviteManagerActionResult> {
  const raw = {
    mode: readForm(formData, 'mode'),
    organizationId: readForm(formData, 'organizationId'),
    email: readForm(formData, 'email'),
    name: readForm(formData, 'name')
  };
  const parsed = assignOrInviteSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireAdmin();

  const result = await createAndAssignManager(prisma, parsed.data, session.sub);
  if (!result.ok) return { ok: false, error: result.error };

  if (result.inviteUrl !== null) {
    // Email is best-effort; the inviteUrl is also returned to the admin UI
    // for a "Copy link" fallback when the SMTP pipeline is disabled. A
    // transport failure must not bubble out of the action: the invite is
    // already created and would look failed while the token is live.
    try {
      const org = await prisma.organization.findUnique({
        where: { id: parsed.data.organizationId },
        select: { name: true }
      });
      await sendManagerInviteEmail({
        to: parsed.data.email,
        organizationName: org?.name ?? 'организация',
        inviteUrl: result.inviteUrl,
        invitedByName: session.name ?? undefined
      });
    } catch (e) {
      log.warn('[admin/manager] send invite email failed', e);
    }
  }

  revalidatePath(`/admin/organizations/${parsed.data.organizationId}`);
  return {
    ok: true,
    user: result.user,
    inviteUrl: result.inviteUrl,
    alreadyHasPassword: result.alreadyHasPassword,
    reactivated: result.reactivated
  };
}

const assignmentIdSchema = z.object({ assignmentId: z.string().min(1) });

export type AssignmentToggleResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'not_found' };

export async function deactivateManagerAssignmentAction(
  formData: FormData
): Promise<AssignmentToggleResult> {
  const parsed = assignmentIdSchema.safeParse({
    assignmentId: readForm(formData, 'assignmentId')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const result = await deactivateAssignment(prisma, parsed.data.assignmentId, session.sub);
  if (!result.ok) return { ok: false, error: result.reason };
  revalidatePath(`/admin/organizations/${result.organizationId}`);
  return { ok: true };
}

export async function reactivateManagerAssignmentAction(
  formData: FormData
): Promise<AssignmentToggleResult> {
  const parsed = assignmentIdSchema.safeParse({
    assignmentId: readForm(formData, 'assignmentId')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const result = await reactivateAssignment(prisma, parsed.data.assignmentId, session.sub);
  if (!result.ok) return { ok: false, error: result.reason };
  revalidatePath(`/admin/organizations/${result.organizationId}`);
  return { ok: true };
}

/**
 * Form-action wrappers that discard the rich result so they're compatible
 * with `<form action={...}>` (which expects `void | Promise<void>`). The
 * underlying action still revalidates the admin org page; any failure is
 * absorbed silently because the destructive operations are infrequent and
 * the only failure mode (`not_found`) means the row was removed under us —
 * which the page refresh will then reflect anyway.
 */
export async function deactivateManagerAssignmentFormAction(formData: FormData): Promise<void> {
  const result = await deactivateManagerAssignmentAction(formData);
  if (!result.ok) log.warn('[admin/manager] deactivateManagerAssignmentFormAction failed', result);
}

export async function reactivateManagerAssignmentFormAction(formData: FormData): Promise<void> {
  const result = await reactivateManagerAssignmentAction(formData);
  if (!result.ok) log.warn('[admin/manager] reactivateManagerAssignmentFormAction failed', result);
}

/**
 * Per-order manager assignment (toggles `Order.managerId`).
 *
 * Distinct from org-level assignment: this is a *first-class* visibility
 * branch for a single order, useful when an admin wants to grant a manager
 * scope to an order whose organization is not in their managedOrgIds. The
 * managerId is also surfaced on the manager's dashboard KPIs.
 *
 * Validation: target user must exist, have `role='manager'`, and be active.
 * `managerUserId=null` clears the assignment.
 */
const assignOrderManagerSchema = z.object({
  orderId: z.string().min(1),
  managerUserId: z
    .string()
    .min(1)
    .nullable()
    /* v8 ignore next -- v is non-empty-string | null (nullable); '' is rejected by min(1) */
    .transform((v) => (v === '' ? null : v))
});

export type AssignOrderManagerActionResult =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      error: 'validation' | 'order_not_found' | 'invalid_manager';
      details?: unknown;
    };

export async function assignOrderManagerAction(
  formData: FormData
): Promise<AssignOrderManagerActionResult> {
  const rawManagerUserId = formData.get('managerUserId');
  const managerUserId =
    typeof rawManagerUserId === 'string' && rawManagerUserId.length > 0
      ? rawManagerUserId
      : null;
  const parsed = assignOrderManagerSchema.safeParse({
    orderId: readForm(formData, 'orderId'),
    managerUserId
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireAdmin();

  // Shared manual-assign service (also used by the leader action) — §5.3.
  const result = await assignOrderManager(prisma, session, {
    orderId: parsed.data.orderId,
    managerUserId: parsed.data.managerUserId
  });
  if (!result.ok) return { ok: false, error: result.error };

  // No-op (manager unchanged) skips revalidation — preserves prior behaviour.
  if (result.changed) revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { ok: true, changed: result.changed };
}

const setManagerRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['leader', 'member'])
});

export type SetManagerRoleActionResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'user_not_found' | 'not_a_manager' };

export async function setManagerRoleAction(
  formData: FormData
): Promise<SetManagerRoleActionResult> {
  const parsed = setManagerRoleSchema.safeParse({
    userId: readForm(formData, 'userId'),
    role: readForm(formData, 'role')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const role: 'leader' | null = parsed.data.role === 'leader' ? 'leader' : null;
  const result = await setManagerRole(prisma, session.sub, parsed.data.userId, role);
  if (!result.ok) return result;

  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { ok: true };
}
