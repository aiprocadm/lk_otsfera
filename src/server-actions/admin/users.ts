'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  createUser,
  updateUser,
  deactivateUser,
  reactivateUser,
  AdminUserError,
  type AdminUserErrorCode
} from '@/lib/services/admin/users';
import { sendAdminUserInviteEmail } from '@/lib/email/send';

type Failure = { ok: false; error: 'validation' | AdminUserErrorCode; details?: unknown };
type Success<T> = T extends void ? { ok: true } : { ok: true } & T;
type ActionResult<T = void> = Success<T> | Failure;

const ROLE_ENUM = z.enum(['organization', 'partner', 'manager', 'student']);

const createSchema = z
  .object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
    role: ROLE_ENUM,
    partnerId: z.string().optional().nullable()
  })
  .refine((d) => d.role !== 'partner' || (d.partnerId && d.partnerId.length > 0), {
    message: 'partnerId required for partner role',
    path: ['partnerId']
  });

const updateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  role: ROLE_ENUM.optional(),
  partnerId: z.string().nullable().optional(),
  isActive: z.coerce.boolean().optional()
});

const targetSchema = z.object({ id: z.string().min(1) });

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function mapErr(e: unknown): Failure {
  if (e instanceof AdminUserError) return { ok: false, error: e.code };
  throw e;
}

function appBaseUrl(): string {
  return process.env.APP_URL?.trim() || 'https://lk.otsfera.ru';
}

export async function createUserAction(
  fd: FormData
): Promise<ActionResult<{ user: { id: string; email: string }; inviteUrl: string }>> {
  const parsed = createSchema.safeParse({
    email: readField(fd, 'email'),
    name: readField(fd, 'name'),
    role: readField(fd, 'role'),
    partnerId: readField(fd, 'partnerId') || null
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  try {
    const result = await createUser(prisma, session.sub, parsed.data);
    const inviteUrl = `${appBaseUrl()}/reset-password?token=${result.inviteToken}`;

    try {
      await sendAdminUserInviteEmail({
        to: parsed.data.email,
        name: parsed.data.name,
        role: parsed.data.role,
        inviteUrl,
        invitedByName: session.name ?? undefined
      });
    } catch (e) {
      console.warn('[admin/users] send invite email failed', e);
    }

    revalidatePath('/admin/users');
    return { ok: true, user: { id: result.user.id, email: result.user.email }, inviteUrl };
  } catch (e) {
    return mapErr(e);
  }
}

export async function updateUserAction(fd: FormData): Promise<ActionResult> {
  const parsed = updateSchema.safeParse({
    id: readField(fd, 'id'),
    name: readField(fd, 'name') || undefined,
    role: readField(fd, 'role') || undefined,
    partnerId: readField(fd, 'partnerId') || undefined,
    isActive: readField(fd, 'isActive') || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };

  const session = await requireAdmin();
  try {
    const { id, ...args } = parsed.data;
    await updateUser(prisma, session.sub, id, args);
    revalidatePath('/admin/users');
    revalidatePath(`/admin/users/${id}`);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function deactivateUserAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  try {
    await deactivateUser(prisma, session.sub, parsed.data.id);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function reactivateUserAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  try {
    await reactivateUser(prisma, session.sub, parsed.data.id);
    revalidatePath('/admin/users');
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

export async function updateUserFormAction(fd: FormData): Promise<void> {
  await updateUserAction(fd);
}

export async function deactivateUserFormAction(fd: FormData): Promise<void> {
  await deactivateUserAction(fd);
}

export async function reactivateUserFormAction(fd: FormData): Promise<void> {
  await reactivateUserAction(fd);
}
