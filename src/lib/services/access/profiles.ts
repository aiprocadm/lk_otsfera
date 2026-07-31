import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import {
  scopeLevelSchema,
  capabilitySchema,
  type ScopeLevel,
  type Capability,
} from '@/lib/auth/accessProfile';

/**
 * G1.4 — CRUD профилей доступа (конструктор ролей). Result-контракт (§3).
 * Company-scoped (граница изоляции C8 — профиль и целевой пользователь обязаны
 * быть в `session.companyId`; чужой id → not_found, не leak-ается существование).
 * Роль-гейт (admin | manager-leader) продублирован здесь (defense-in-depth §4);
 * server-action тоже гейтит через requireAdmin/requireManagerLeader.
 */

export type AccessProfileErrorCode = 'forbidden' | 'not_found' | 'name_taken' | 'validation';

class AccessProfileError extends Error {
  readonly code: 'not_found';
  constructor(code: 'not_found') {
    super(code);
    this.code = code;
    this.name = 'AccessProfileError';
  }
}

export type AccessProfileInput = {
  name: string;
  orders: ScopeLevel;
  organizations: ScopeLevel;
  threads: ScopeLevel;
  documents: ScopeLevel;
  finance: ScopeLevel;
  leads: ScopeLevel;
  tasks: ScopeLevel;
  capabilities: Capability[];
};

export type AccessProfileListRow = AccessProfileInput & { id: string; usersCount: number };

const inputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  orders: scopeLevelSchema,
  organizations: scopeLevelSchema,
  threads: scopeLevelSchema,
  documents: scopeLevelSchema,
  finance: scopeLevelSchema,
  leads: scopeLevelSchema,
  tasks: scopeLevelSchema,
  capabilities: z.array(capabilitySchema),
});

function canManageProfiles(session: SessionPayload): boolean {
  if (session.role === 'admin') return true;
  return session.role === 'manager' && session.managerRole === 'leader';
}

/** Actor-guard shared by all mutations: role + presence of a company scope. */
function requireManager(session: SessionPayload): { companyId: string } | { error: 'forbidden' } {
  if (!canManageProfiles(session) || !session.companyId) return { error: 'forbidden' };
  return { companyId: session.companyId };
}

function toColumns(input: z.infer<typeof inputSchema>) {
  return {
    name: input.name.trim(),
    ordersScope: input.orders,
    organizationsScope: input.organizations,
    threadsScope: input.threads,
    documentsScope: input.documents,
    financeScope: input.finance,
    leadsScope: input.leads,
    tasksScope: input.tasks,
    capabilities: [...new Set(input.capabilities)],
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export async function listAccessProfiles(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<
  { ok: true; rows: AccessProfileListRow[] } | { ok: false; error: AccessProfileErrorCode }
> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };

  const profiles = await prisma.accessProfile.findMany({
    where: { companyId: gate.companyId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { users: true } } },
  });

  return {
    ok: true,
    rows: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      orders: p.ordersScope,
      organizations: p.organizationsScope,
      threads: p.threadsScope,
      documents: p.documentsScope,
      finance: p.financeScope,
      leads: p.leadsScope,
      tasks: p.tasksScope,
      capabilities: p.capabilities as Capability[],
      usersCount: p._count.users,
    })),
  };
}

export type AssignableUser = {
  id: string;
  name: string;
  email: string;
  accessProfileId: string | null;
};

/** Менеджеры компании — кандидаты на назначение профиля (для UI-дропдауна). */
export async function listAssignableUsers(
  prisma: PrismaClient,
  session: SessionPayload
): Promise<{ ok: true; rows: AssignableUser[] } | { ok: false; error: AccessProfileErrorCode }> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };

  const rows = await prisma.user.findMany({
    where: { companyId: gate.companyId, role: 'manager' },
    select: { id: true, name: true, email: true, accessProfileId: true },
    orderBy: { name: 'asc' },
  });
  return { ok: true, rows };
}

export async function createAccessProfile(
  prisma: PrismaClient,
  session: SessionPayload,
  input: AccessProfileInput
): Promise<{ ok: true; id: string } | { ok: false; error: AccessProfileErrorCode }> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    const created = await prisma.$transaction(async (tx) => {
      const columns = toColumns(parsed.data);
      const row = await tx.accessProfile.create({
        data: { companyId: gate.companyId, ...columns },
      });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'access_profile_created',
        entity: 'access_profile',
        entityId: row.id,
        after: columns,
      });
      return row;
    });
    return { ok: true, id: created.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'name_taken' };
    throw e;
  }
}

export async function updateAccessProfile(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string,
  input: AccessProfileInput
): Promise<{ ok: true } | { ok: false; error: AccessProfileErrorCode }> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.accessProfile.findUnique({
        where: { id },
        select: {
          companyId: true,
          name: true,
          ordersScope: true,
          organizationsScope: true,
          threadsScope: true,
          documentsScope: true,
          financeScope: true,
          leadsScope: true,
          tasksScope: true,
          capabilities: true,
        },
      });
      if (!before || before.companyId !== gate.companyId) throw new AccessProfileError('not_found');

      const columns = toColumns(parsed.data);
      await tx.accessProfile.update({ where: { id }, data: columns });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'access_profile_updated',
        entity: 'access_profile',
        entityId: id,
        before: { ...before, companyId: undefined },
        after: columns,
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AccessProfileError) return { ok: false, error: e.code };
    if (isUniqueViolation(e)) return { ok: false, error: 'name_taken' };
    throw e;
  }
}

export async function deleteAccessProfile(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true } | { ok: false; error: AccessProfileErrorCode }> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.accessProfile.findUnique({
        where: { id },
        select: { companyId: true, name: true },
      });
      if (!before || before.companyId !== gate.companyId) throw new AccessProfileError('not_found');
      // User.accessProfileId FK is ON DELETE SET NULL → назначенные юзеры откатываются в legacy.
      await tx.accessProfile.delete({ where: { id } });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'access_profile_deleted',
        entity: 'access_profile',
        entityId: id,
        before: { name: before.name },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AccessProfileError) return { ok: false, error: e.code };
    throw e;
  }
}

export async function assignUserProfile(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { userId: string; profileId: string | null }
): Promise<{ ok: true } | { ok: false; error: AccessProfileErrorCode }> {
  const gate = requireManager(session);
  if ('error' in gate) return { ok: false, error: gate.error };

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: args.userId },
        select: { companyId: true, accessProfileId: true },
      });
      if (!user || user.companyId !== gate.companyId) throw new AccessProfileError('not_found');
      if (args.profileId !== null) {
        const profile = await tx.accessProfile.findUnique({
          where: { id: args.profileId },
          select: { companyId: true },
        });
        if (!profile || profile.companyId !== gate.companyId)
          throw new AccessProfileError('not_found');
      }
      await tx.user.update({
        where: { id: args.userId },
        data: { accessProfileId: args.profileId },
      });
      await recordAudit(tx, {
        userId: session.sub,
        action: 'user_access_profile_assigned',
        entity: 'user',
        entityId: args.userId,
        before: { accessProfileId: user.accessProfileId },
        after: { accessProfileId: args.profileId },
      });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof AccessProfileError) return { ok: false, error: e.code };
    throw e;
  }
}
