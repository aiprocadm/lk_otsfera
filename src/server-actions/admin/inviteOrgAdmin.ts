'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  createOrgAdminInvite,
  OrgInviteError,
  type OrgInviteErrorCode
} from '@/lib/services/organization/invite';
import { OrgMemberError, type OrgMemberErrorCode } from '@/lib/services/organization/team';
import { sendOrgInviteEmail } from '@/lib/email/send';

export type InviteAdminActionError =
  | 'validation'
  | OrgInviteErrorCode
  | OrgMemberErrorCode;

export type InviteAdminActionResult =
  | {
      ok: true;
      user: { id: string; email: string };
      inviteUrl: string | null;
      alreadyHasPassword: boolean;
    }
  | { ok: false; error: InviteAdminActionError; details?: unknown };

const schema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(200)
});

function readFormValue(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export async function inviteAdminOrgAdminAction(
  formData: FormData
): Promise<InviteAdminActionResult> {
  const parsed = schema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    email: readFormValue(formData, 'email'),
    name: readFormValue(formData, 'name')
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation', details: parsed.error.flatten() };
  }

  const session = await requireAdmin();

  try {
    const result = await createOrgAdminInvite(
      prisma,
      parsed.data,
      {
        actorUserId: session.sub,
        source: 'platform_admin'
      }
    );

    // Email is best-effort: the invite is already created and inviteUrl is
    // returned to the UI as a "Copy link" fallback. A transport failure must
    // not surface as an action error (the invite would look failed while the
    // token is live).
    if (result.inviteUrl !== null) {
      try {
        const org = await prisma.organization.findUnique({
          where: { id: parsed.data.organizationId },
          select: { name: true }
        });
        await sendOrgInviteEmail({
          to: parsed.data.email,
          organizationName: org?.name ?? 'организация',
          inviteUrl: result.inviteUrl,
          invitedByName: session.name ?? undefined
        });
      } catch (e) {
        console.warn('[admin/inviteOrgAdmin] send invite email failed', e);
      }
    }

    revalidatePath(`/admin/organizations/${parsed.data.organizationId}`);
    return {
      ok: true,
      user: result.user,
      inviteUrl: result.inviteUrl,
      alreadyHasPassword: result.alreadyHasPassword
    };
  } catch (e) {
    if (e instanceof OrgInviteError) return { ok: false, error: e.code };
    if (e instanceof OrgMemberError) return { ok: false, error: e.code };
    throw e;
  }
}
