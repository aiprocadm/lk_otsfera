import type { PrismaClient } from '@prisma/client';

/**
 * Была ли организация заведена импортом автоматически (`У-54`).
 *
 * Источник — журнал аудита: именно так требование и описывает пометку
 * («помечается в аудите источником `payment_import_auto`»), поэтому
 * отдельного поля в таблице не заводим. Возвращает дату и имя файла, чтобы
 * карточка могла сказать «из выгрузки 1С от <дата>», а не просто «автоматически».
 */
export async function getAutoCreatedFrom1C(
  prisma: PrismaClient,
  organizationId: string
): Promise<{ at: string; fileName: string | null } | null> {
  const row = await prisma.auditLog.findFirst({
    where: {
      entity: 'organization',
      entityId: organizationId,
      action: 'organization_created_auto',
    },
    orderBy: { createdAt: 'desc' },
    // `recordAudit` кладёт полезную нагрузку в `meta.after` — своей колонки
    // `after` у таблицы нет.
    select: { createdAt: true, meta: true },
  });
  if (!row) return null;
  const after = (row.meta as { after?: { fileName?: unknown } } | null)?.after;
  const fileName = typeof after?.fileName === 'string' ? after.fileName : null;
  return { at: row.createdAt.toISOString(), fileName };
}
