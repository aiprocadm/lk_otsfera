'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  updateOrganization,
  AdminOrgError,
  type AdminOrgErrorCode
} from '@/lib/services/admin/organizations';
import {
  setOrgCommissionRate,
  clearOrgCommissionRate
} from '@/lib/services/partner/rateOverride';

type Failure = {
  ok: false;
  error: 'validation' | AdminOrgErrorCode | 'rate_out_of_range';
  details?: unknown;
};
type Success<T> = T extends void ? { ok: true } : { ok: true } & T;
type ActionResult<T = void> = Success<T> | Failure;

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  inn: z.string().max(20).nullable().optional(),
  kpp: z.string().max(20).nullable().optional()
});

const overrideSchema = z.object({
  organizationId: z.string().min(1),
  ratePercent: z.coerce.number().gt(0).lt(100).optional(),
  reason: z.string().min(1).max(500),
  clear: z.coerce.boolean().optional()
});

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function mapErr(e: unknown): Failure {
  if (e instanceof AdminOrgError) return { ok: false, error: e.code };
  if (e instanceof Error) {
    if (e.message.startsWith('NOT_FOUND')) return { ok: false, error: 'not_found' };
    if (e.message.startsWith('RATE_OUT_OF_RANGE')) return { ok: false, error: 'rate_out_of_range' };
  }
  throw e;
}

export async function updateOrganizationAction(fd: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: readField(fd, 'id'),
    name: readField(fd, 'name') || undefined,
    inn: readField(fd, 'inn') || undefined,
    kpp: readField(fd, 'kpp') || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  try {
    const { id, ...args } = parsed.data;
    await updateOrganization(prisma, session.sub, id, args);
    revalidatePath('/admin/organizations');
    revalidatePath(`/admin/organizations/${id}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function setOrgRateOverrideAction(fd: FormData): Promise<ActionResult> {
  const parsed = overrideSchema.safeParse({
    organizationId: readField(fd, 'organizationId'),
    ratePercent: readField(fd, 'ratePercent') || undefined,
    reason: readField(fd, 'reason'),
    clear: readField(fd, 'clear') || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();

  const { organizationId, ratePercent, reason, clear } = parsed.data;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { partnerId: true }
  });
  if (!org) return { ok: false as const, error: 'not_found' as const };

  // Standalone orgs (no partner) have no intermediary-commission override to set/clear.
  if (org.partnerId === null) return { ok: false as const, error: 'not_found' as const };
  const partnerId: string = org.partnerId;

  try {
    if (clear) {
      await clearOrgCommissionRate(prisma, {
        organizationId,
        partnerId,
        reason,
        changedByUserId: session.sub
      });
    } else if (ratePercent !== undefined) {
      await setOrgCommissionRate(prisma, {
        organizationId,
        partnerId,
        newRate: ratePercent / 100,
        reason,
        changedByUserId: session.sub
      });
    } else {
      return { ok: false as const, error: 'validation' as const };
    }
    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

// <form action> wrappers must return void, so the Result is discarded — but a
// user-triggerable failure (validation, rate_out_of_range) must at least leave
// a trace until these forms migrate to useActionState with inline feedback.
export async function updateOrgFormAction(fd: FormData): Promise<void> {
  const result = await updateOrganizationAction(fd);
  if (!result.ok) console.warn('[admin/organizations] updateOrgFormAction failed', result);
}

export async function setOrgRateOverrideFormAction(fd: FormData): Promise<void> {
  const result = await setOrgRateOverrideAction(fd);
  if (!result.ok) console.warn('[admin/organizations] setOrgRateOverrideFormAction failed', result);
}
