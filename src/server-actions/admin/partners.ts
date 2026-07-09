'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  createPartnerWithAdmin,
  updatePartner,
  deactivatePartner,
  reactivatePartner,
  type AdminPartnerErrorCode
} from '@/lib/services/admin/partners';
import { sendAdminUserInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

type Failure = { ok: false; error: 'validation' | AdminPartnerErrorCode; details?: unknown };
type Success<T> = T extends void ? { ok: true } : { ok: true } & T;
type ActionResult<T = void> = Success<T> | Failure;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/, 'lowercase, цифры и дефис'),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  adminEmail: z.string().email(),
  adminName: z.string().min(1).max(200)
});

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  commissionRate: z.coerce.number().min(0).max(100).nullable().optional(),
  isActive: z.coerce.boolean().optional(),
  // Валидируем дату: пустое → опускаем; невалидная строка → ошибка валидации.
  // Иначе Invalid Date дотекла бы до resolveRateAt (getTime() NaN → ставка молча
  // не применилась бы ни к одному платежу — денежная ошибка).
  effectiveFrom: z
    .string()
    .optional()
    .refine((s) => s === undefined || s === '' || !isNaN(new Date(s).getTime()), {
      message: 'effectiveFrom must be a valid date'
    })
});

const targetSchema = z.object({ id: z.string().min(1) });

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function appBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export async function createPartnerWithAdminAction(
  fd: FormData
): Promise<ActionResult<{ partner: { id: string; name: string; slug: string }; user: { id: string; email: string }; inviteUrl: string }>> {
  const parsed = createSchema.safeParse({
    name: readField(fd, 'name'),
    slug: readField(fd, 'slug'),
    commissionRate: readField(fd, 'commissionRate') || undefined,
    adminEmail: readField(fd, 'adminEmail'),
    adminName: readField(fd, 'adminName')
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  const serviceArgs = {
    ...parsed.data,
    commissionRate: parsed.data.commissionRate != null ? parsed.data.commissionRate / 100 : undefined
  };
  const result = await createPartnerWithAdmin(prisma, session.sub, serviceArgs);
  if (!result.ok) return { ok: false, error: result.error };
  const inviteUrl = `${appBaseUrl()}/reset-password?token=${result.inviteToken}`;

  try {
    await sendAdminUserInviteEmail({
      to: parsed.data.adminEmail,
      name: parsed.data.adminName,
      role: 'partner',
      inviteUrl,
      invitedByName: session.name ?? undefined
    });
  } catch (e) {
    log.warn('[admin/partners] send invite email failed', e);
  }

  revalidatePath('/admin/partners');
  return { ok: true, partner: result.partner, user: result.user, inviteUrl };
}

export async function updatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: readField(fd, 'id'),
    name: readField(fd, 'name') || undefined,
    commissionRate: readField(fd, 'commissionRate') || undefined,
    isActive: readField(fd, 'isActive') || undefined,
    effectiveFrom: readField(fd, 'effectiveFrom') || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  const { id, ...raw } = parsed.data;
  const args = {
    ...raw,
    commissionRate: raw.commissionRate != null ? raw.commissionRate / 100 : raw.commissionRate,
    effectiveFrom: raw.effectiveFrom ? new Date(raw.effectiveFrom) : undefined
  };
  const res = await updatePartner(prisma, session.sub, id, args);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/admin/partners');
  revalidatePath(`/admin/partners/${id}`);
  return { ok: true };
}

export async function deactivatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const res = await deactivatePartner(prisma, session.sub, parsed.data.id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/admin/partners');
  revalidatePath(`/admin/partners/${parsed.data.id}`);
  return { ok: true };
}

export async function reactivatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const res = await reactivatePartner(prisma, session.sub, parsed.data.id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath('/admin/partners');
  revalidatePath(`/admin/partners/${parsed.data.id}`);
  return { ok: true };
}

// <form action> wrappers must return void, so the Result is discarded — log
// failures so they're traceable until these forms migrate to useActionState.
export async function updatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await updatePartnerAction(fd);
  if (!result.ok) log.warn('[admin/partners] updatePartnerFormAction failed', result);
}

export async function deactivatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await deactivatePartnerAction(fd);
  if (!result.ok) log.warn('[admin/partners] deactivatePartnerFormAction failed', result);
}

export async function reactivatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await reactivatePartnerAction(fd);
  if (!result.ok) log.warn('[admin/partners] reactivatePartnerFormAction failed', result);
}
