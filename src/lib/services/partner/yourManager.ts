import type { PrismaClient } from '@prisma/client';
import { getOrgYourManager, type YourManagerView } from '@/lib/services/organization/yourManager';

/**
 * Блок «Ваш менеджер» у партнёра (этап 6 ТЗ 12.09.2026, `У-240`, решение `Р-Э6-6`).
 *
 * Сначала ответственный за партнёра (`Partner.managerId`, правит администратор
 * в карточке партнёра); если он не назначен или уже не работает — менеджер
 * первой организации портфеля (по дате создания). Нет ни того, ни другого —
 * блок говорит «менеджер назначается».
 */
export async function getPartnerYourManager(
  prisma: PrismaClient,
  partnerId: string
): Promise<YourManagerView> {
  const partner = await prisma.partner.findUnique({
    where: { id: partnerId },
    select: { manager: { select: { name: true, email: true, isActive: true, role: true } } },
  });
  const m = partner?.manager;
  if (m && m.isActive && (m.role === 'manager' || m.role === 'leader')) {
    return { manager: { name: m.name, email: m.email }, othersCount: 0 };
  }
  const org = await prisma.organization.findFirst({
    where: { partnerId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (!org) return { manager: null, othersCount: 0 };
  return getOrgYourManager(prisma, org.id);
}
