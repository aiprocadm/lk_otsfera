import type { PrismaClient } from '@prisma/client';
import type { PartnerRoleInPartner } from '@/lib/auth/jwt';

/** Узкая строка селекта организаций: ровно id+name. */
type PartnerOrgOption = { id: string; name: string };

/**
 * Скоуп партнёра для селектов. `partnerId` — обязательная строка намеренно:
 * при `undefined` Prisma снимет фильтр целиком и селект покажет чужие
 * организации (§4, изоляция клиентского контура).
 */
type PartnerOrgScope = {
  partnerId: string;
  partnerRole?: PartnerRoleInPartner | null | undefined;
  assignedOrgIds?: string[] | undefined;
};

/**
 * Все организации партнёра (портфель целиком) — для форм, где выбор идёт по
 * всему партнёру: приглашение сотрудника и мастер заявок на обучение.
 */
export async function listPartnerOrgOptions(
  prisma: PrismaClient,
  args: { partnerId: string }
): Promise<PartnerOrgOption[]> {
  return prisma.organization.findMany({
    where: { partnerId: args.partnerId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}

/**
 * Организации в границе видимости конкретного пользователя партнёра
 * (ФТ-6.2): partner-manager сужается до закреплённых `assignedOrgIds`, чтобы
 * фильтр реестра не подсказывал названия чужих организаций. Пустой
 * `assignedOrgIds` даёт пустое сужение, а не «все».
 */
export async function listVisiblePartnerOrgOptions(
  prisma: PrismaClient,
  session: PartnerOrgScope
): Promise<PartnerOrgOption[]> {
  return prisma.organization.findMany({
    where: {
      partnerId: session.partnerId,
      ...(session.partnerRole === 'manager' ? { id: { in: session.assignedOrgIds ?? [] } } : {}),
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });
}
