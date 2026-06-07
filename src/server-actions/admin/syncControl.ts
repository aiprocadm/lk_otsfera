'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import {
  triggerSync,
  setSchedulePaused,
  rewindCursor,
  type TriggerResult,
  type PauseResult,
  type RewindResult,
} from '@/lib/services/admin/syncControl';

type Validation = { ok: false; error: 'validation'; details?: unknown };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

const triggerSchema = z.object({ entity: z.string().min(1) });
const pauseSchema = z.object({ schedulerId: z.string().min(1), paused: z.coerce.boolean() });
const cursorSchema = z.object({ entity: z.string().min(1), cursor: z.string() });

export async function triggerSyncAction(fd: FormData): Promise<TriggerResult | Validation> {
  const parsed = triggerSchema.safeParse({ entity: readField(fd, 'entity') });
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireAdmin();
  const result = await triggerSync(prisma, session.sub, parsed.data.entity);
  revalidatePath('/admin/sync');
  return result;
}

export async function setSchedulePausedAction(fd: FormData): Promise<PauseResult | Validation> {
  const parsed = pauseSchema.safeParse({ schedulerId: readField(fd, 'schedulerId'), paused: readField(fd, 'paused') });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };
  const session = await requireAdmin();
  const result = await setSchedulePaused(prisma, session.sub, parsed.data.schedulerId, parsed.data.paused);
  revalidatePath('/admin/sync');
  return result;
}

export async function rewindCursorAction(fd: FormData): Promise<RewindResult | Validation> {
  const parsed = cursorSchema.safeParse({ entity: readField(fd, 'entity'), cursor: readField(fd, 'cursor') });
  if (!parsed.success) return { ok: false, error: 'validation', details: parsed.error.flatten() };
  const session = await requireAdmin();
  const cursor = parsed.data.cursor.trim() === '' ? null : parsed.data.cursor;
  const result = await rewindCursor(prisma, session.sub, parsed.data.entity, cursor);
  revalidatePath('/admin/sync');
  return result;
}
