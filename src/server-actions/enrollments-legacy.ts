'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/guard';
import { requireSession } from '@/lib/auth/guard';
import { assignLegacyDirection } from '@/lib/services/enrollments/legacyDirections';
import { str } from '@/lib/actions/form';

/**
 * Разбор старой заявки (`У-34а`, шаг 2, этап 6).
 *
 * Экран одноразовый и админский, поэтому гард здесь жёсткий: только `admin`.
 * Тонкий адаптер — вся логика и аудит в сервисе (CLAUDE.md §3).
 */
export async function assignLegacyDirectionAction(
  fd: FormData
): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const guard = await requireSession();
  if (!guard.ok) return { ok: false, error: 'Нет доступа.' };
  const admin = requireAdmin(guard.value);
  if (!admin.ok)
    return { ok: false, error: 'Разбор старых заявок доступен только администратору.' };

  const requestId = str(fd, 'requestId');
  const directionId = str(fd, 'directionId');
  if (!requestId || !directionId) {
    return { ok: false, error: 'Выберите направление обучения.' };
  }

  const res = await assignLegacyDirection(prisma, guard.value, { requestId, directionId });
  if (!res.ok) {
    return {
      ok: false,
      error:
        res.error === 'not_found'
          ? 'Заявка не найдена — возможно, её уже разобрали.'
          : 'Такого направления нет в справочнике.',
    };
  }

  revalidatePath('/admin/enrollments/legacy');
  return res;
}
