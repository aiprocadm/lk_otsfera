import type { PrismaClient } from '@prisma/client';

export type OrgRef = {
  /**
   * Локальный id организации в ЛК (`У-88`). Ставится только локальными путями
   * (импорт выписки, матч по ключу названия) — у данных из 1С его нет. Нужен
   * потому, что организация без ИНН и без 1С-ключа иначе неадресуема: writer
   * пропустил бы платёж как `organization_not_found`, и строка потерялась бы
   * молча, вместо того чтобы уйти в очередь ручного разбора.
   */
  id?: string | null;
  externalId?: string | null;
  inn?: string | null;
};

/**
 * Разрешение организации по externalId → ИНН.
 *
 * `canWrite` ОБЯЗАТЕЛЕН (Т-24): backfill `externalId` — это запись в базу, и до
 * этапа 5 он выполнялся даже в режиме предпросмотра (shadow). Параметр без
 * значения по умолчанию — чтобы каждый новый вызов явно решал, можно ли писать.
 */
export async function resolveOrganizationRef(db: PrismaClient, ref: OrgRef, canWrite: boolean) {
  // Прямой адрес ЛК — точнее любого реквизита, поэтому он первый.
  if (ref.id) {
    const byId = await db.organization.findUnique({
      where: { id: ref.id },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byId) return byId;
  }
  if (ref.externalId) {
    const byExt = await db.organization.findFirst({
      where: { externalId: ref.externalId },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byExt) return byExt;
  }
  if (ref.inn) {
    const byInn = await db.organization.findFirst({
      where: { inn: ref.inn },
      select: { id: true, partnerId: true, companyId: true, externalId: true },
    });
    if (byInn) {
      if (canWrite && ref.externalId && !byInn.externalId) {
        await db.organization.update({
          where: { id: byInn.id },
          data: { externalId: ref.externalId },
        });
        return { ...byInn, externalId: ref.externalId };
      }
      return byInn;
    }
  }
  return null;
}
