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
  type AdminUserErrorCode
} from '@/lib/services/admin/users';
import { sendAdminUserInviteEmail } from '@/lib/email/send';
import { log } from '@/lib/logging';

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
  const result = await createUser(prisma, session.sub, parsed.data);
  if (!result.ok) return result;
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
    log.warn('[admin/users] send invite email failed', e);
  }

  revalidatePath('/admin/users');
  return { ok: true, user: { id: result.user.id, email: result.user.email }, inviteUrl };
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
  const { id, ...args } = parsed.data;
  const result = await updateUser(prisma, session.sub, id, args);
  if (!result.ok) return result;
  revalidatePath('/admin/users');
  revalidatePath(`/admin/users/${id}`);
  return { ok: true };
}

export async function deactivateUserAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const result = await deactivateUser(prisma, session.sub, parsed.data.id);
  if (!result.ok) return result;
  revalidatePath('/admin/users');
  return { ok: true };
}

export async function reactivateUserAction(fd: FormData): Promise<ActionResult> {
  const parsed = targetSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireAdmin();
  const result = await reactivateUser(prisma, session.sub, parsed.data.id);
  if (!result.ok) return result;
  revalidatePath('/admin/users');
  return { ok: true };
}

// <form action> wrappers must return void, so the Result is discarded — log
// failures so they're traceable until these forms migrate to useActionState.
export async function updateUserFormAction(fd: FormData): Promise<void> {
  const result = await updateUserAction(fd);
  if (!result.ok) log.warn('[admin/users] updateUserFormAction failed', result);
}

export async function deactivateUserFormAction(fd: FormData): Promise<void> {
  const result = await deactivateUserAction(fd);
  if (!result.ok) log.warn('[admin/users] deactivateUserFormAction failed', result);
}

export async function reactivateUserFormAction(fd: FormData): Promise<void> {
  const result = await reactivateUserAction(fd);
  if (!result.ok) log.warn('[admin/users] reactivateUserFormAction failed', result);
}
