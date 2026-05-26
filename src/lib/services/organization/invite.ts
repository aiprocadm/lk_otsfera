import type { PrismaClient } from '@prisma/client';
import {
  inviteMember,
  type InviteMemberResult
} from './team';

export type OrgInviteErrorCode = 'not_found' | 'forbidden';

export class OrgInviteError extends Error {
  readonly code: OrgInviteErrorCode;
  constructor(code: OrgInviteErrorCode) {
    super(code);
    this.code = code;
    this.name = 'OrgInviteError';
  }
}

export type OrgInviteSource = 'partner' | 'platform_admin';

export type CreateOrgAdminInviteArgs = {
  organizationId: string;
  email: string;
  name: string;
};

export type CreateOrgAdminInviteContext = {
  actorUserId: string;
  source: OrgInviteSource;
  /**
   * Only relevant when source === 'partner'. The partnerId attached to the
   * acting partner-admin's session. Used to enforce that partner-admins can
   * only invite into organisations from their own portfolio.
   */
  actorPartnerId?: string | null;
};

/**
 * Cross-cabinet shim around `inviteMember` — used by partner-admin and
 * platform-admin server actions to grant an organisation-admin access.
 *
 * Policy:
 *  - source='partner': org.partnerId MUST equal context.actorPartnerId.
 *    (The session-level guard requirePartnerAdmin has already vetted
 *    that the actor is a partner-admin — this is the per-org scope check.)
 *  - source='platform_admin': allowed for any organisation. The caller's
 *    requireAdmin guard is the only gate.
 *
 * Audit: `inviteMember` writes 'org_member_invited' with after.source so the
 * trail records which cabinet initiated the invite.
 */
export async function createOrgAdminInvite(
  prisma: PrismaClient,
  args: CreateOrgAdminInviteArgs,
  ctx: CreateOrgAdminInviteContext
): Promise<InviteMemberResult> {
  const org = await prisma.organization.findUnique({
    where: { id: args.organizationId },
    select: { id: true, partnerId: true }
  });
  if (!org) throw new OrgInviteError('not_found');

  if (ctx.source === 'partner') {
    if (!ctx.actorPartnerId || org.partnerId !== ctx.actorPartnerId) {
      throw new OrgInviteError('forbidden');
    }
  }

  return inviteMember(
    prisma,
    {
      organizationId: args.organizationId,
      email: args.email,
      name: args.name,
      roleInOrg: 'admin'
    },
    ctx.actorUserId,
    { source: ctx.source }
  );
}
