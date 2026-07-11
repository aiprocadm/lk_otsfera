'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requirePartnerAdmin } from '@/lib/auth/requireRole';
import {
  createOrgAdminInvite,
  OrgInviteError,
  type OrgInviteErrorCode
} from '@/lib/services/organization/invite';
import { OrgMemberError, type OrgMemberErrorCode } from '@/lib/services/organization/team';
import { sendOrgInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

export type InvitePartnerActionError =
  | 'validation'
  | OrgInviteErrorCode
  | OrgMemberErrorCode;

export type InvitePartnerActionResult =
  | {
      ok: true;
      user: { id: string; email: string };
      inviteUrl: string | null;
      alreadyHasPassword: boolean;
    }
  | { ok: false; error: InvitePartnerActionError };

const schema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(200)
});

function readFormValue(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export async function invitePartnerOrgAdminAction(
  formData: FormData
): Promise<InvitePartnerActionResult> {
  const parsed = schema.safeParse({
    organizationId: readFormValue(formData, 'organizationId'),
    email: readFormValue(formData, 'email'),
    name: readFormValue(formData, 'name')
  });
  if (!parsed.success) {
    return { ok: false, error: 'validation' };
  }

  const session = await requirePartnerAdmin();
  if (!session.partnerId) {
    return { ok: false, error: 'forbidden' };
  }

  try {
    const result = await createOrgAdminInvite(
      prisma,
      parsed.data,
      {
        actorUserId: session.sub,
        source: 'partner',
        actorPartnerId: session.partnerId
      }
    );

    // Email is best-effort: the invite is already created and inviteUrl is
    // returned to the UI as a "Copy link" fallback; a transport failure must
    // not surface as an action error.
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
        log.warn('[partner/inviteOrgAdmin] send invite email failed', e);
      }
    }

    revalidatePath(`/partner/portfolio/${parsed.data.organizationId}`);
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
