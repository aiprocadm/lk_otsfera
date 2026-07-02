'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  createAccessProfile,
  updateAccessProfile,
  deleteAccessProfile,
  assignUserProfile,
  type AccessProfileInput,
  type AccessProfileErrorCode
} from '@/lib/services/access/profiles';
import type { ScopeLevel, Capability } from '@/lib/auth/accessProfile';

/**
 * G1.4 — server-actions конструктора ролей. Общие для /leader и /admin: роль
 * (admin | manager-leader) и company-scope энфорсит сервис (`canManageProfiles`),
 * поэтому здесь достаточно `requireSession()`. Валидацию охватов/флагов делает
 * Zod-схема сервиса (сырые строки формы → validation при мусоре).
 */

type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: AccessProfileErrorCode };

function readStr(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

function readInput(fd: FormData): AccessProfileInput {
  return {
    name: readStr(fd, 'name'),
    orders: readStr(fd, 'orders') as ScopeLevel,
    organizations: readStr(fd, 'organizations') as ScopeLevel,
    threads: readStr(fd, 'threads') as ScopeLevel,
    documents: readStr(fd, 'documents') as ScopeLevel,
    finance: readStr(fd, 'finance') as ScopeLevel,
    leads: readStr(fd, 'leads') as ScopeLevel,
    capabilities: fd.getAll('capabilities').filter((v): v is string => typeof v === 'string') as Capability[]
  };
}

function revalidate(): void {
  revalidatePath('/leader/roles');
  revalidatePath('/admin/roles');
}

export async function createAccessProfileAction(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  const res = await createAccessProfile(prisma, session, readInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true, id: res.id };
}

export async function updateAccessProfileAction(fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = readStr(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await updateAccessProfile(prisma, session, id, readInput(fd));
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function deleteAccessProfileAction(fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const id = readStr(fd, 'id');
  if (!id) return { ok: false, error: 'validation' };
  const res = await deleteAccessProfile(prisma, session, id);
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}

export async function assignUserProfileAction(fd: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const userId = readStr(fd, 'userId');
  if (!userId) return { ok: false, error: 'validation' };
  const profileIdRaw = readStr(fd, 'profileId');
  const res = await assignUserProfile(prisma, session, {
    userId,
    profileId: profileIdRaw === '' ? null : profileIdRaw
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidate();
  return { ok: true };
}
