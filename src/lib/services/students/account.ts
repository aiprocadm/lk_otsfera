import type { PrismaClient } from '@prisma/client';

/**
 * Связь учётки слушателя с карточками справочника (`Р-2-1`, `Р-2-2`, этап 2
 * ТЗ 13.10.2026).
 *
 * Учётка (`User`, роль `student`) и карточка (`Student`, сотрудник
 * организации) раньше не были связаны ничем, кроме совпадения e-mail. Поэтому
 * подтверждённая заявка «не появлялась» у слушателя (`Д-52`): показать её было
 * негде и уведомить было некого. Связь ставится автоматически по e-mail без
 * учёта регистра — при подтверждении заявки и при каждом входе в кабинет.
 *
 * Правило безопасности: карточку, уже привязанную к другой учётке, не
 * перехватываем — только свободные (`userId IS NULL`).
 */

type PrismaLike = Pick<PrismaClient, 'student' | 'user'>;

/**
 * Привязать к учётке свободные карточки с её e-mail. Возвращает число
 * привязанных. Адрес и роль читаются из базы, а не из токена входа: в токене
 * e-mail может отсутствовать, а отключённой учётке карточки не отдаём.
 */
export async function linkStudentCardsToAccount(
  prisma: PrismaLike,
  userId: string
): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, isActive: true },
  });
  if (!user || user.role !== 'student' || !user.isActive) return 0;
  const email = user.email.trim();
  if (!email) return 0;
  const res = await prisma.student.updateMany({
    where: { userId: null, email: { equals: email, mode: 'insensitive' } },
    data: { userId },
  });
  return res.count;
}

/**
 * Карточки → учётки слушателей (для подтверждения заявки): каждой свободной
 * карточке с e-mail ищется учётка `student` с тем же адресом. Возвращает
 * пары, которые теперь связаны (и связанные раньше), — им и уйдёт
 * уведомление о назначенном обучении.
 */
export async function linkCardsToStudentAccounts(
  prisma: PrismaLike,
  studentIds: string[]
): Promise<{ studentId: string; userId: string }[]> {
  if (studentIds.length === 0) return [];
  const cards = await prisma.student.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, email: true, userId: true },
  });
  const linked: { studentId: string; userId: string }[] = [];
  for (const card of cards) {
    if (card.userId) {
      linked.push({ studentId: card.id, userId: card.userId });
      continue;
    }
    const email = card.email?.trim();
    if (!email) continue;
    const account = await prisma.user.findFirst({
      where: { role: 'student', isActive: true, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!account) continue;
    const res = await prisma.student.updateMany({
      where: { id: card.id, userId: null },
      data: { userId: account.id },
    });
    // Гонка: карточку только что привязали к другой учётке — её не трогаем.
    if (res.count === 1) linked.push({ studentId: card.id, userId: account.id });
  }
  return linked;
}
