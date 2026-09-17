import type { PrismaClient } from '@prisma/client';

/**
 * Блок «Ваш менеджер» у заказчика (этап 6 ТЗ 12.09.2026, `У-240`, решение `Р-Э6-6`).
 *
 * Менеджеров у организации может быть несколько (`OrganizationManager` без
 * признака «главный»): показываем первого активного по `assignedAt` и
 * «и ещё N» без контактов остальных. Клиенту отдаются имя и e-mail —
 * телефона у сотрудника в модели нет (`Р-Б-17`), внутренний номер служебный.
 */

export type YourManagerView = {
  manager: { name: string; email: string } | null;
  othersCount: number;
};

export async function getOrgYourManager(
  prisma: PrismaClient,
  organizationId: string
): Promise<YourManagerView> {
  const rows = await prisma.organizationManager.findMany({
    where: {
      organizationId,
      isActive: true,
      user: { isActive: true, role: { in: ['manager', 'leader'] } },
    },
    orderBy: [{ assignedAt: 'asc' }, { userId: 'asc' }],
    select: { user: { select: { name: true, email: true } } },
  });
  const [first, ...rest] = rows;
  return {
    manager: first ? { name: first.user.name, email: first.user.email } : null,
    othersCount: rest.length,
  };
}
