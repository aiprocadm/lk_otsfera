'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import {
  saveSchedulePattern,
  type SaveScheduleResult,
} from '@/lib/services/admin/syncSchedules';
import { saveSettings, type SaveEntry, type SettingKey } from '@/lib/config/integrationSettings';
import { resetIntegrationSettingsCache } from '@/lib/config/integrationSettingsCache';
import { recordAudit } from '@/lib/auth/audit';

export type OneCParamsResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'value_out_of_range' | 'secrets_key_missing' };
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

/**
 * Сохранить расписание задачи (`У-125`).
 *
 * Платформенный рычаг: обмен один на все компании, поэтому только админ
 * (решение `Р-22`). Пустая строка — «вернуть умолчание из кода».
 */
export async function saveSchedulePatternAction(
  schedulerId: string,
  pattern: string
): Promise<SaveScheduleResult> {
  const session = await requireAdmin();
  const result = await saveSchedulePattern(prisma, session.sub, schedulerId, pattern);
  if (result.ok) revalidatePath('/admin/settings/integrations/1c/auto');
  return result;
}

/**
 * Сохранить параметры обмена (`У-125`). Числовые поля проверяются границами:
 * таймаут в ноль миллисекунд или отрицательное перекрытие курсора тихо
 * останавливают обмен, а человек ищет причину в 1С.
 */
export async function saveOneCParamsAction(fd: FormData): Promise<OneCParamsResult> {
  const session = await requireAdmin();

  const mode = readField(fd, 'onec_mode').trim().toLowerCase();
  if (mode !== '' && mode !== 'live' && mode !== 'shadow') {
    return { ok: false, error: 'validation' };
  }

  const numeric: Array<{ field: string; key: SettingKey; min: number; max: number }> = [
    { field: 'onec_httpTimeoutMs', key: 'onec.httpTimeoutMs', min: 1000, max: 600_000 },
    { field: 'onec_cursorOverlapMinutes', key: 'onec.cursorOverlapMinutes', min: 0, max: 1440 },
    { field: 'onec_pendingMaxAttempts', key: 'onec.pendingMaxAttempts', min: 1, max: 1000 },
    { field: 'onec_pendingMaxAgeDays', key: 'onec.pendingMaxAgeDays', min: 1, max: 365 },
  ];

  const entries: SaveEntry[] = [
    { key: 'onec.mode', value: mode },
    { key: 'onec.defaultCompanyId', value: readField(fd, 'onec_defaultCompanyId').trim() },
  ];

  for (const n of numeric) {
    const raw = readField(fd, n.field).trim();
    if (raw === '') {
      // Пусто — «вернуть значение сервера»: строку удаляем, а не пишем пустую.
      entries.push({ key: n.key, clear: true });
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < n.min || parsed > n.max) {
      return { ok: false, error: 'value_out_of_range' };
    }
    entries.push({ key: n.key, value: String(parsed) });
  }

  const res = await saveSettings(prisma, session.sub, entries);
  if (!res.ok) return res;

  resetIntegrationSettingsCache();
  await recordAudit(prisma, {
    action: 'onec_params_changed',
    entity: 'sync_schedule',
    entityId: 'onec.params',
    userId: session.sub,
    // Значения не секретные, но и не нужны в журнале целиком — важен факт.
    after: { mode: mode === '' ? null : mode },
  });
  revalidatePath('/admin/settings/integrations/1c/auto');
  return { ok: true };
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
