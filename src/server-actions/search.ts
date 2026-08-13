'use server';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { globalSearch } from '@/lib/services/search/globalSearch';

/**
 * Поиск по данным для командной палитры (`У-75`, этап 9).
 *
 * Своего поиска палитра не заводит: зовёт тот же сервис, что и страница
 * поиска, — со всеми его скоупами и журналом доступа к ПДн. Иначе появилась
 * бы вторая, более слабая дверь к тем же данным.
 *
 * `teamModeOverride` передаёт только руководитель — ровно как страница
 * `/leader/search`: он смотрит на всю компанию.
 */
export async function paletteSearchAction(q: string, teamModeOverride?: boolean) {
  const session = await requireSession();
  return globalSearch(prisma, session, {
    q,
    ...(teamModeOverride ? { teamModeOverride: true } : {}),
  });
}
