import type { PrismaClient } from '@prisma/client';

/**
 * Точечное чтение названия организации — нужно письмам-приглашениям
 * (admin/partner/organization кабинеты) для человекочитаемой подписи.
 *
 * Вынесено из server-actions (CLAUDE.md §2: прямых запросов в экшенах нет).
 * Отдельная функция, а не поле в результате invite-сервиса: вызывающий
 * пропускает чтение целиком, когда inviteUrl === null (письмо не шлётся) —
 * это поведение сохранено.
 *
 * Возвращает `null`, если организации нет: подстановку запасного названия
 * делает вызывающий (у каждого кабинета своя строка).
 */
export async function getOrganizationName(
  prisma: PrismaClient,
  organizationId: string
): Promise<string | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  return org?.name ?? null;
}
