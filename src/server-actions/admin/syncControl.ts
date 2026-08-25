'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin, requireAdminOrManagerLeader } from '@/lib/auth/requireRole';
import {
  triggerSync,
  setSchedulePaused,
  rewindCursor,
  type TriggerResult,
  type PauseResult,
  type RewindResult,
} from '@/lib/services/admin/syncControl';

type Validation = { ok: false; error: 'validation' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

const triggerSchema = z.object({ entity: z.string().min(1) });
const pauseSchema = z.object({ schedulerId: z.string().min(1), paused: z.coerce.boolean() });
const cursorSchema = z.object({ entity: z.string().min(1), cursor: z.string() });

/**
 * Ручной запуск обмена. `У-118`: руководителю он тоже нужен — раньше вкладки
 * «Автообмен» у него просто не было (дефект `Д-33`), и при вставшем обмене он
 * ничего не мог сделать сам.
 *
 * Пауза расписания и перемотка курсора остаются админскими намеренно: они
 * платформенные (обмен один на все компании), а запуск — операция «сходить за
 * свежими данными сейчас», её последствия обратимы.
 */
export async function triggerSyncAction(fd: FormData): Promise<TriggerResult | Validation> {
  const parsed = triggerSchema.safeParse({ entity: readField(fd, 'entity') });
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireAdminOrManagerLeader();
  const result = await triggerSync(prisma, session.sub, parsed.data.entity);
  revalidatePath('/admin/settings/integrations/1c/auto');
  revalidatePath('/leader/settings/integrations/1c/auto');
  return result;
}

export async function setSchedulePausedAction(fd: FormData): Promise<PauseResult | Validation> {
  const parsed = pauseSchema.safeParse({
    schedulerId: readField(fd, 'schedulerId'),
    paused: readField(fd, 'paused'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };
  // Платформенный рычаг: расписание одно на все компании — только админ.
  const session = await requireAdmin();
  const result = await setSchedulePaused(
    prisma,
    session.sub,
    parsed.data.schedulerId,
    parsed.data.paused
  );
  revalidatePath('/admin/settings/integrations/1c/auto');
  return result;
}

export async function rewindCursorAction(fd: FormData): Promise<RewindResult | Validation> {
  const parsed = cursorSchema.safeParse({
    entity: readField(fd, 'entity'),
    cursor: readField(fd, 'cursor'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireAdmin();
  const cursor = parsed.data.cursor.trim() === '' ? null : parsed.data.cursor;
  const result = await rewindCursor(prisma, session.sub, parsed.data.entity, cursor);
  revalidatePath('/admin/settings/integrations/1c/auto');
  return result;
}
