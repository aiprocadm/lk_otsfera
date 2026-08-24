'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin, requireAdminOrManagerLeader } from '@/lib/auth/requireRole';
import {
  createOrganization,
  updateOrganization,
  type AdminOrgErrorCode,
} from '@/lib/services/admin/organizations';
import { applyOrgRateOverride } from '@/lib/services/admin/orgRateOverride';
import { log } from '@/lib/logging';

type Failure = {
  ok: false;
  error: 'validation' | AdminOrgErrorCode | 'rate_out_of_range';
};
type Success<T> = T extends void ? { ok: true } : { ok: true } & T;
type ActionResult<T = void> = Success<T> | Failure;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  inn: z.string().max(20).optional(),
  kpp: z.string().max(20).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  inn: z.string().max(20).nullable().optional(),
  kpp: z.string().max(20).nullable().optional(),
});

const overrideSchema = z.object({
  organizationId: z.string().min(1),
  ratePercent: z.coerce.number().gt(0).lt(100).optional(),
  reason: z.string().min(1).max(500),
  clear: z.coerce.boolean().optional(),
});

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

export async function createOrganizationAction(
  fd: FormData
): Promise<ActionResult<{ id: string }>> {
  const parsed = createSchema.safeParse({
    name: readField(fd, 'name'),
    inn: readField(fd, 'inn') || undefined,
    kpp: readField(fd, 'kpp') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  // exactOptionalPropertyTypes: CreateOrgArgs различает «ключа нет» и «ключ = undefined».
  const res = await createOrganization(prisma, session.sub, {
    name: parsed.data.name,
    ...(parsed.data.inn !== undefined ? { inn: parsed.data.inn } : {}),
    ...(parsed.data.kpp !== undefined ? { kpp: parsed.data.kpp } : {}),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/admin/organizations');
  return { ok: true, id: res.id };
}

export async function updateOrganizationAction(fd: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: readField(fd, 'id'),
    name: readField(fd, 'name') || undefined,
    inn: readField(fd, 'inn') || undefined,
    kpp: readField(fd, 'kpp') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const { id, name, inn, kpp } = parsed.data;
  // exactOptionalPropertyTypes: UpdateOrgArgs различает «ключа нет» и «ключ = undefined».
  const res = await updateOrganization(prisma, session.sub, id, {
    ...(name !== undefined ? { name } : {}),
    ...(inn !== undefined ? { inn } : {}),
    ...(kpp !== undefined ? { kpp } : {}),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/admin/organizations');
  revalidatePath(`/admin/organizations/${id}`);
  return { ok: true };
}

export async function setOrgRateOverrideAction(fd: FormData): Promise<ActionResult> {
  const parsed = overrideSchema.safeParse({
    organizationId: readField(fd, 'organizationId'),
    ratePercent: readField(fd, 'ratePercent') || undefined,
    reason: readField(fd, 'reason'),
    clear: readField(fd, 'clear') || undefined,
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  // `У-99`: ставку по организации ведут администратор и руководитель. Раньше
  // это мог только администратор, и руководителю приходилось просить.
  const session = await requireAdminOrManagerLeader();

  const { organizationId, ratePercent, reason, clear } = parsed.data;

  // C8: у руководителя граница — своя компания. Чужая организация отвечает
  // `not_found`, а не `forbidden`: существование чужой организации не
  // подтверждаем (тот же приём, что в карточке организации).
  if (session.role !== 'admin') {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { companyId: true },
    });
    if (!org || !session.companyId || org.companyId !== session.companyId) {
      return { ok: false, error: 'not_found' };
    }
  }

  // exactOptionalPropertyTypes: аргументы сервиса различают «ключа нет» и «ключ = undefined».
  const res = await applyOrgRateOverride(prisma, {
    organizationId,
    reason,
    changedByUserId: session.sub,
    ...(ratePercent !== undefined ? { ratePercent } : {}),
    ...(clear !== undefined ? { clear } : {}),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath(`/admin/organizations/${organizationId}`);
  // Карточка организации есть у трёх кабинетов — ставка меняется во всех
  // сразу, иначе руководитель увидит старое число до перезагрузки.
  revalidatePath(`/leader/organizations/${organizationId}`);
  revalidatePath(`/manager/organizations/${organizationId}`);
  return { ok: true };
}

// <form action> wrappers must return void, so the Result is discarded — but a
// user-triggerable failure (validation, rate_out_of_range) must at least leave
// a trace until these forms migrate to useActionState with inline feedback.
export async function updateOrgFormAction(fd: FormData): Promise<void> {
  const result = await updateOrganizationAction(fd);
  if (!result.ok) log.warn('[admin/organizations] updateOrgFormAction failed', result);
}

export async function setOrgRateOverrideFormAction(fd: FormData): Promise<void> {
  const result = await setOrgRateOverrideAction(fd);
  if (!result.ok) log.warn('[admin/organizations] setOrgRateOverrideFormAction failed', result);
}
