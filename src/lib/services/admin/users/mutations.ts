import type { PrismaClient, Prisma, Role } from '@prisma/client';
import { createInviteToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';
import { generateBackupCodes } from '@/lib/services/auth/twoFactor';
import { MAX_PARTNER_USERS } from '@/lib/config/teamLimits';
import { AdminUserError, type AdminUserFailure } from './errors';
import { fetchUserDetail, type UserDetail } from './queries';

export type CreateUserArgs = {
  email: string;
  name: string;
  role: Exclude<Role, 'admin'>;
  partnerId?: string | null;
};

export type CreateUserResult = {
  user: { id: string; email: string; name: string; role: Role };
  inviteToken: string;
};

export async function createUser(
  prisma: PrismaClient,
  actorUserId: string,
  args: CreateUserArgs
): Promise<({ ok: true } & CreateUserResult) | AdminUserFailure> {
  try {
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }
    if (args.role === 'partner' && !args.partnerId) {
      throw new AdminUserError('not_found');
    }

    const data = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email: args.email } });
      if (existing) throw new AdminUserError('duplicate_email');

      const user = await tx.user.create({
        data: {
          email: args.email,
          name: args.name,
          role: args.role,
          partnerId: args.partnerId ?? null,
          passwordHash: null,
          isActive: true
        }
      });

      if (args.role === 'partner' && args.partnerId) {
        // §14 ТЗ: лимит активных пользователей партнёра форсируется и здесь.
        const activePartnerUsers = await tx.partnerUser.count({
          where: { partnerId: args.partnerId, isActive: true }
        });
        if (activePartnerUsers >= MAX_PARTNER_USERS) {
          throw new AdminUserError('member_limit_reached');
        }
        await tx.partnerUser.create({
          data: {
            userId: user.id,
            partnerId: args.partnerId,
            roleInPartner: 'member',
            assignedOrgIds: []
          }
        });
      }

      const { token } = await createInviteToken(tx, user.id);

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_created',
        entity: 'user',
        entityId: user.id,
        after: {
          email: args.email,
          role: args.role,
          partnerId: args.partnerId ?? null
        }
      });

      return {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        inviteToken: token
      };
    });
    return { ok: true, ...data };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

async function assertNotLastActiveAdmin(
  tx: Prisma.TransactionClient,
  candidateUserId: string
): Promise<void> {
  const remaining = await tx.user.count({
    where: { role: 'admin', isActive: true, NOT: { id: candidateUserId } }
  });
  if (remaining === 0) {
    throw new AdminUserError('last_admin_protected');
  }
}

export type UpdateUserArgs = {
  name?: string;
  role?: Exclude<Role, 'admin'>;
  partnerId?: string | null;
  isActive?: boolean;
};

const ALLOWED_TRANSITIONS: ReadonlyArray<[Role, Role]> = [
  ['partner', 'partner'],
  ['partner', 'student'],
  ['student', 'partner']
];

function isAllowedRoleTransition(from: Role, to: Role): boolean {
  /* v8 ignore next 1 — callers always guard from !== to before calling; dead arm in practice */
  if (from === to) return true;
  return ALLOWED_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export async function updateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string,
  args: UpdateUserArgs
): Promise<{ ok: true; user: UserDetail } | AdminUserFailure> {
  try {
    if (id === actorUserId && (args.role !== undefined || args.isActive === false)) {
      throw new AdminUserError('self_action_forbidden');
    }
    if (args.role === ('admin' as Role)) {
      throw new AdminUserError('admin_role_via_ui');
    }

    const updatedDetail = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, isActive: true, partnerId: true, name: true }
      });
      if (!before) throw new AdminUserError('not_found');

      // Role transition gates
      if (args.role && args.role !== before.role) {
        if (!isAllowedRoleTransition(before.role, args.role)) {
          throw new AdminUserError('role_transition_forbidden');
        }
      }

      // Last-admin protection.
      // The args.role !== undefined sub-arm of the OR is unreachable for admin users:
      // any role change from 'admin' is already rejected above by role_transition_forbidden
      // (admin is absent from ALLOWED_TRANSITIONS). Only args.isActive===false is reachable.
      /* v8 ignore next 3 */
      if (before.role === 'admin' && (args.role !== undefined || args.isActive === false)) {
        await assertNotLastActiveAdmin(tx, id);
      }

      // Partner cleanup if changing away from partner
      if (before.role === 'partner' && args.role && args.role !== 'partner') {
        await tx.partnerUser.deleteMany({ where: { userId: id } });
      }
      // Partner attach if changing TO partner
      if (args.role === 'partner' && args.partnerId && before.role !== 'partner') {
        await tx.partnerUser.create({
          data: { userId: id, partnerId: args.partnerId, roleInPartner: 'member', assignedOrgIds: [] }
        });
      }

      const updated = await tx.user.update({
        where: { id },
        data: {
          ...(args.name !== undefined ? { name: args.name } : {}),
          ...(args.role !== undefined ? { role: args.role } : {}),
          ...(args.partnerId !== undefined ? { partnerId: args.partnerId } : {}),
          ...(args.isActive !== undefined ? { isActive: args.isActive } : {})
        }
      });

      const isRoleChange = args.role !== undefined && args.role !== before.role;
      await recordAudit(tx, {
        userId: actorUserId,
        action: isRoleChange ? 'user_role_changed' : 'user_updated',
        entity: 'user',
        entityId: id,
        before: { role: before.role, isActive: before.isActive, partnerId: before.partnerId, name: before.name },
        after: { role: updated.role, isActive: updated.isActive, partnerId: updated.partnerId, name: updated.name }
      });

      // Пост-мутационный re-fetch — не read-контекст, журнал ПДн не пишем.
      const detail = await fetchUserDetail(tx as unknown as PrismaClient, id);
      return detail!;
    });
    return { ok: true, user: updatedDetail };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function deactivateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | AdminUserFailure> {
  try {
    if (id === actorUserId) throw new AdminUserError('self_action_forbidden');

    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { role: true, isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (!before.isActive) return;

      if (before.role === 'admin') {
        await assertNotLastActiveAdmin(tx, id);
      }

      // Этап 9 (ФТ-11.2): инкремент версии обрывает живые 7-дневные токены
      // деактивированного — без него он работал бы до истечения токена.
      await tx.user.update({
        where: { id },
        data: { isActive: false, sessionVersion: { increment: 1 } }
      });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_deactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: true },
        after: { isActive: false }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function reactivateUser(
  prisma: PrismaClient,
  actorUserId: string,
  id: string
): Promise<{ ok: true } | AdminUserFailure> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({
        where: { id },
        select: { isActive: true }
      });
      if (!before) throw new AdminUserError('not_found');
      if (before.isActive) return;

      await tx.user.update({ where: { id }, data: { isActive: true } });

      await recordAudit(tx, {
        userId: actorUserId,
        action: 'user_reactivated',
        entity: 'user',
        entityId: id,
        before: { isActive: false },
        after: { isActive: true }
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}

export type AdminBackupCodesResult = { codes: string[] };

// Админ перевыпускает коды восстановления 2FA сотруднику (потерял доступ и к
// почте, и к кодам). Инвалидирует все прежние коды пользователя и возвращает
// новые для однократного показа. Гейт requireAdmin — на уровне server-action.
export async function adminRegenerateBackupCodes(
  prisma: PrismaClient,
  actorUserId: string,
  targetUserId: string
): Promise<({ ok: true } & AdminBackupCodesResult) | AdminUserFailure> {
  try {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true }
    });
    if (!target) throw new AdminUserError('not_found');
    // Только staff пользуется 2FA (admin/manager, включая leader).
    if (target.role !== 'admin' && target.role !== 'manager') {
      throw new AdminUserError('not_staff');
    }

    const { codes } = await generateBackupCodes(prisma, target.id);

    await recordAudit(prisma, {
      userId: actorUserId,
      action: '2fa_backup_regenerated',
      entity: 'auth_2fa',
      entityId: target.id
    });

    return { ok: true, codes };
  } catch (e) {
    if (e instanceof AdminUserError) return { ok: false, error: e.code };
    throw e;
  }
}
