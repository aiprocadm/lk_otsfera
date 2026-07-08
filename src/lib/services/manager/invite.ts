import type { PrismaClient, Prisma } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Admin-facing "assign or invite a manager to an organization" service.
 *
 * Two modes:
 *   - `existing` — admin picks an already-registered manager by email. We
 *     refuse anything that's not a manager (`role_conflict`) and refuse if
 *     the email is unknown (`user_not_found`).
 *   - `new` — admin types an email that may or may not exist. If unknown we
 *     create the user with `role='manager'` and `passwordHash=null`, and
 *     return an invite URL that lets the new manager set a password. If the
 *     email already belongs to a manager we silently reuse the account
 *     (same as the `existing` flow); if it belongs to a non-manager we
 *     refuse (`role_conflict`).
 *
 * Reactivation: if a deactivated assignment already exists for the same
 * `(organizationId, userId)` pair, we flip it back to active in-place rather
 * than violating the `@@unique` constraint. The `assignedBy` and `assignedAt`
 * fields are refreshed so the timeline reflects the *current* admin action.
 *
 * The whole flow is wrapped in `prisma.$transaction` so a partial failure
 * (e.g. the token creation throws) does not leave a freshly-created user
 * dangling without an assignment, or vice versa.
 */

export type ManagerInviteErrorCode =
  | 'already_assigned'
  | 'role_conflict'
  | 'user_not_found'
  | 'org_not_found'
  // C8: manager and organization must share a company. Assigning across the
  // company boundary is the upstream root cause of cross-company IDOR (§4).
  | 'company_mismatch';

export class ManagerInviteError extends Error {
  readonly code: ManagerInviteErrorCode;
  constructor(code: ManagerInviteErrorCode) {
    super(code);
    this.code = code;
    this.name = 'ManagerInviteError';
  }
}

export type CreateAndAssignManagerInput =
  | { mode: 'existing'; organizationId: string; email: string }
  | { mode: 'new'; organizationId: string; email: string; name?: string };

export type CreateAndAssignManagerResult = {
  user: { id: string; email: string };
  inviteUrl: string | null;
  /** True if the user already had a password (so no invite token was minted). */
  alreadyHasPassword: boolean;
  /** Whether the assignment row was created vs reactivated. */
  reactivated: boolean;
};

function getAppBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export async function createAndAssignManager(
  prisma: PrismaClient,
  args: CreateAndAssignManagerInput,
  actorUserId: string
): Promise<
  | ({ ok: true } & CreateAndAssignManagerResult)
  | { ok: false; error: ManagerInviteErrorCode }
> {
  try {
    const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.findUnique({
      where: { id: args.organizationId },
      select: { id: true, companyId: true }
    });
    if (!org) throw new ManagerInviteError('org_not_found');

    let user = await tx.user.findUnique({ where: { email: args.email } });

    if (args.mode === 'existing') {
      if (!user) throw new ManagerInviteError('user_not_found');
      if (user.role !== 'manager') throw new ManagerInviteError('role_conflict');
    } else {
      // mode === 'new'
      if (user && user.role !== 'manager') {
        throw new ManagerInviteError('role_conflict');
      }
      if (!user) {
        // A freshly-invited manager is born into the organization's company —
        // managers derive their entire C8 scope from User.companyId, so leaving
        // it null would make the new manager invisible to the leader roster and
        // deny-all in company-wide reads. Stamping org.companyId here also makes
        // the company-floor assertion below hold by construction.
        user = await tx.user.create({
          data: {
            email: args.email,
            name: args.name ?? args.email,
            role: 'manager',
            isActive: true,
            passwordHash: null,
            companyId: org.companyId
          }
        });
      }
    }

    // C8 company floor (defense-in-depth): a manager may only be assigned to an
    // organization in their own company. Freshly-created managers inherit
    // org.companyId above, so this only rejects an *existing* manager account
    // being pulled across the company boundary (or a company-less org/manager
    // mismatch). Cross-company OrganizationManager rows are the upstream cause of
    // the inbound-message bind IDOR fixed at src/server-actions/inbound.ts.
    if (user.companyId !== org.companyId) {
      throw new ManagerInviteError('company_mismatch');
    }

    const existing = await tx.organizationManager.findUnique({
      where: {
        organizationId_userId: {
          organizationId: args.organizationId,
          userId: user.id
        }
      }
    });

    let assignmentId: string;
    let reactivated = false;
    if (existing) {
      if (existing.isActive) {
        throw new ManagerInviteError('already_assigned');
      }
      const updated = await tx.organizationManager.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          deactivatedAt: null,
          assignedAt: new Date(),
          assignedBy: actorUserId
        }
      });
      assignmentId = updated.id;
      reactivated = true;
    } else {
      const created = await tx.organizationManager.create({
        data: {
          organizationId: args.organizationId,
          userId: user.id,
          isActive: true,
          assignedBy: actorUserId
        }
      });
      assignmentId = created.id;
    }

    // Mint an invite token only when the manager has never set a password
    // (newly-created user OR an existing passwordless account being
    // re-onboarded). For accounts with an existing password, the admin
    // should rely on the in-app notification, not the email link.
    let inviteUrl: string | null = null;
    let alreadyHasPassword = false;
    if (user.passwordHash === null) {
      const { token } = await createInviteToken(tx, user.id);
      inviteUrl = `${getAppBaseUrl()}/reset-password?token=${token}`;
    } else {
      alreadyHasPassword = true;
    }

    await recordAudit(tx, {
      userId: actorUserId,
      action: reactivated ? 'manager_reactivated' : 'manager_assigned',
      entity: 'organization_manager',
      entityId: assignmentId,
      after: {
        organizationId: args.organizationId,
        userId: user.id,
        email: user.email,
        mode: args.mode,
        reactivated,
        alreadyHasPassword
      }
    });

    return {
      user: { id: user.id, email: user.email },
      inviteUrl,
      alreadyHasPassword,
      reactivated
    };
    });
    return { ok: true, ...result };
  } catch (e) {
    if (e instanceof ManagerInviteError) return { ok: false, error: e.code };
    throw e;
  }
}

/**
 * Lower-level helpers exposed for direct admin server actions (deactivate /
 * reactivate without minting a token).
 */

export async function deactivateAssignment(
  prisma: PrismaClient,
  assignmentId: string,
  actorUserId: string
): Promise<{ ok: true; organizationId: string } | { ok: false; reason: 'not_found' }> {
  return prisma.$transaction<
    { ok: true; organizationId: string } | { ok: false; reason: 'not_found' }
  >(async (tx: Prisma.TransactionClient) => {
    const row = await tx.organizationManager.findUnique({ where: { id: assignmentId } });
    if (!row) return { ok: false, reason: 'not_found' };
    if (!row.isActive) return { ok: true, organizationId: row.organizationId }; // idempotent
    await tx.organizationManager.update({
      where: { id: row.id },
      data: { isActive: false, deactivatedAt: new Date() }
    });
    await recordAudit(tx, {
      userId: actorUserId,
      action: 'manager_deactivated',
      entity: 'organization_manager',
      entityId: row.id,
      before: { isActive: true },
      after: {
        isActive: false,
        organizationId: row.organizationId,
        userId: row.userId
      }
    });
    return { ok: true, organizationId: row.organizationId };
  });
}

export async function reactivateAssignment(
  prisma: PrismaClient,
  assignmentId: string,
  actorUserId: string
): Promise<{ ok: true; organizationId: string } | { ok: false; reason: 'not_found' }> {
  return prisma.$transaction<
    { ok: true; organizationId: string } | { ok: false; reason: 'not_found' }
  >(async (tx: Prisma.TransactionClient) => {
    const row = await tx.organizationManager.findUnique({ where: { id: assignmentId } });
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.isActive) return { ok: true, organizationId: row.organizationId }; // idempotent
    await tx.organizationManager.update({
      where: { id: row.id },
      data: {
        isActive: true,
        deactivatedAt: null,
        assignedAt: new Date(),
        assignedBy: actorUserId
      }
    });
    await recordAudit(tx, {
      userId: actorUserId,
      action: 'manager_reactivated',
      entity: 'organization_manager',
      entityId: row.id,
      before: { isActive: false },
      after: {
        isActive: true,
        organizationId: row.organizationId,
        userId: row.userId
      }
    });
    return { ok: true, organizationId: row.organizationId };
  });
}
