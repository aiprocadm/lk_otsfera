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
  AdminPartnerError,
  type AdminPartnerErrorCode
} from '@/lib/services/admin/partners';
import { sendAdminUserInviteEmail } from '@/lib/email/send';

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
  isActive: z.coerce.boolean().optional()
});

const targetSchema = z.object({ id: z.string().min(1) });

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function mapErr(e: unknown): Failure {
  if (e instanceof AdminPartnerError) return { ok: false, error: e.code };
  throw e;
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
  try {
    const serviceArgs = {
      ...parsed.data,
      commissionRate: parsed.data.commissionRate != null ? parsed.data.commissionRate / 100 : undefined
    };
    const result = await createPartnerWithAdmin(prisma, session.sub, serviceArgs);
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
      console.warn('[admin/partners] send invite email failed', e);
    }

    revalidatePath('/admin/partners');
    return { ok: true, partner: result.partner, user: result.user, inviteUrl };
  } catch (e) {
    return mapErr(e);
  }
}

export async function updatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: readField(fd, 'id'),
    name: readField(fd, 'name') || undefined,
    commissionRate: readField(fd, 'commissionRate') || undefined,
    isActive: readField(fd, 'isActive') || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  try {
    const { id, ...raw } = parsed.data;
    const args = {
      ...raw,
      commissionRate: raw.commissionRate != null ? raw.commissionRate / 100 : raw.commissionRate
    };
    await updatePartner(prisma, session.sub, id, args);
    revalidatePath('/admin/partners');
    revalidatePath(`/admin/partners/${id}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function deactivatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  try {
    await deactivatePartner(prisma, session.sub, parsed.data.id);
    revalidatePath('/admin/partners');
    revalidatePath(`/admin/partners/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function reactivatePartnerAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  try {
    await reactivatePartner(prisma, session.sub, parsed.data.id);
    revalidatePath('/admin/partners');
    revalidatePath(`/admin/partners/${parsed.data.id}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

// <form action> wrappers must return void, so the Result is discarded — log
// failures so they're traceable until these forms migrate to useActionState.
export async function updatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await updatePartnerAction(fd);
  if (!result.ok) console.warn('[admin/partners] updatePartnerFormAction failed', result);
}

export async function deactivatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await deactivatePartnerAction(fd);
  if (!result.ok) console.warn('[admin/partners] deactivatePartnerFormAction failed', result);
}

export async function reactivatePartnerFormAction(fd: FormData): Promise<void> {
  const result = await reactivatePartnerAction(fd);
  if (!result.ok) console.warn('[admin/partners] reactivatePartnerFormAction failed', result);
}
