import type { PrismaClient } from '@prisma/client';

/**
 * Сколько расхождений по дебиторке нашла ПОСЛЕДНЯЯ сверка (`У-257`).
 *
 * Считаем по последней записи, а не по всем за историю, по двум причинам.
 * Во-первых, расхождение, разобранное вчера, не должно держать оповещение
 * горящим сегодня. Во-вторых, сверка идёт раз в сутки и переписывает картину
 * целиком: складывать её проходы значило бы считать одно и то же расхождение
 * столько раз, сколько ночей его не чинили.
 *
 * Отдельный файл, а не функция внутри сверки: его зовёт оценка оповещений,
 * которой не нужны ни адаптер 1С, ни запись в журнал обмена.
 */
export async function countLastDebtMismatches(prisma: PrismaClient): Promise<number> {
  const row = await prisma.syncLog.findFirst({
    where: { entity: 'debt', operation: 'reconcile' },
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
  });
  const payload = row?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  const list = (payload as { mismatches?: unknown }).mismatches;
  return Array.isArray(list) ? list.length : 0;
}
