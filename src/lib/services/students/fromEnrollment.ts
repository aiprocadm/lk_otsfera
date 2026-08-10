import type { Prisma } from '@prisma/client';
import { normalizeSnils } from './duplicates';

/**
 * Автосоздание сотрудников при одобрении заявки (`У-29`, этап 5 PR-2).
 *
 * Одобрили заявку — значит слушатели заведены. Работает **внутри той же
 * транзакции**, что и одобрение (решение заказчика 09.08.2026): если завести
 * человека не удалось, заявка не одобряется. «Одобрено, но людей нет» — худший
 * из возможных исходов: заказчик считает, что обучение согласовано.
 *
 * Идемпотентно: позиция с уже проставленным `studentId` пропускается, поэтому
 * повторный вызов (ретрай, двойной клик) мусора не создаёт.
 *
 * Дедупликация — по правилу `У-22`, но выполняется **в транзакции** и без
 * участия человека: молча переиспользуем найденного сотрудника вместо создания
 * второго. Диалог с выбором тут неуместен — одобрение массовое.
 */
export async function attachStudentsToApprovedItems(
  tx: Prisma.TransactionClient,
  args: { requestId: string; organizationId: string }
): Promise<{ created: number; reused: number }> {
  const items = await tx.enrollmentRequestItem.findMany({
    where: { requestId: args.requestId, studentId: null },
    select: { id: true, fullName: true, email: true, position: true, snils: true, birthDate: true },
  });
  if (items.length === 0) return { created: 0, reused: 0 };

  // Сотрудники организации нужны целиком: сравнение СНИЛС идёт по цифрам,
  // а в базе он может лежать с разделителями.
  const existing = await tx.student.findMany({
    where: { organizationId: args.organizationId },
    select: { id: true, name: true, snils: true, birthDate: true, email: true },
  });

  let created = 0;
  let reused = 0;

  for (const item of items) {
    const snils = normalizeSnils(item.snils);
    const match =
      (snils ? existing.find((s) => normalizeSnils(s.snils) === snils) : undefined) ??
      (item.birthDate
        ? existing.find(
            (s) =>
              s.name === item.fullName &&
              s.birthDate !== null &&
              s.birthDate.getTime() === item.birthDate!.getTime()
          )
        : undefined) ??
      (item.email
        ? existing.find((s) => s.name === item.fullName && s.email === item.email)
        : undefined);

    if (match) {
      await tx.enrollmentRequestItem.update({
        where: { id: item.id },
        data: { studentId: match.id },
      });
      reused++;
      continue;
    }

    const student = await tx.student.create({
      data: {
        organizationId: args.organizationId,
        name: item.fullName,
        email: item.email || null,
        position: item.position,
        snils: item.snils,
        birthDate: item.birthDate,
      },
      select: { id: true },
    });
    await tx.enrollmentRequestItem.update({
      where: { id: item.id },
      data: { studentId: student.id },
    });
    // Добавляем в локальный список **значения из позиции**, а не то, что вернула
    // база: две одинаковые позиции в одной заявке не должны дать двух
    // сотрудников, и это не должно зависеть от набора полей в `select`.
    existing.push({
      id: student.id,
      name: item.fullName,
      snils: item.snils,
      birthDate: item.birthDate,
      email: item.email || null,
    });
    created++;
  }

  return { created, reused };
}
