import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Разбор старых заявок без направления (`У-34а`, этап 6 ТЗ понятности).
 *
 * До этапа направление лежало на шапке заявки, и часть заявок хранит курс
 * **текстом** (`legacyCourseTitle`), а `directionId` у них пуст. Такие заявки
 * бэкфилл не трогает: служебное направление «Без указания» заводить запрещено
 * (решение `Р-8`), поэтому направление им проставляет человек.
 *
 * Пока список непустой, миграция-«замок» (сделать `directionId` позиции
 * обязательным) накатываться **не должна** — она упадёт на боевых данных.
 */
export type LegacyEnrollmentRow = {
  id: string;
  createdAt: Date;
  organizationName: string;
  legacyCourseTitle: string | null;
  itemsCount: number;
};

/** Заявки, у которых направления нет ни на шапке, ни в позициях. */
export async function listLegacyEnrollments(prisma: PrismaClient): Promise<LegacyEnrollmentRow[]> {
  const rows = await prisma.enrollmentRequest.findMany({
    where: { directionId: null, items: { some: { directionId: null } } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      createdAt: true,
      legacyCourseTitle: true,
      organization: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    organizationName: r.organization?.name ?? 'Организация не указана',
    legacyCourseTitle: r.legacyCourseTitle,
    itemsCount: r._count.items,
  }));
}

/** Сколько заявок ещё не разобрано — этим числом пользуется страж «замка». */
export async function countLegacyEnrollments(prisma: PrismaClient): Promise<number> {
  return prisma.enrollmentRequest.count({
    where: { directionId: null, items: { some: { directionId: null } } },
  });
}

/**
 * Проставить направление всем позициям заявки (шаг 2 `У-34а`).
 *
 * Направление ставится **позициям**, а не шапке: шапочное поле объявлено
 * устаревшим (`У-36`) и уедет следующим этапом, поэтому писать в него значит
 * создавать данные, которые тут же придётся переносить.
 */
export async function assignLegacyDirection(
  prisma: PrismaClient,
  session: SessionPayload,
  args: { requestId: string; directionId: string }
): Promise<{ ok: true; updated: number } | { ok: false; error: 'not_found' | 'validation' }> {
  const direction = await prisma.trainingDirection.findUnique({
    where: { id: args.directionId },
    select: { id: true, name: true },
  });
  if (!direction) return { ok: false, error: 'validation' };

  const request = await prisma.enrollmentRequest.findUnique({
    where: { id: args.requestId },
    select: { id: true, legacyCourseTitle: true },
  });
  if (!request) return { ok: false, error: 'not_found' };

  const res = await prisma.enrollmentRequestItem.updateMany({
    where: { requestId: args.requestId, directionId: null },
    data: { directionId: direction.id },
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'enrollment_legacy_direction_assigned',
    entity: 'enrollment_request',
    entityId: args.requestId,
    before: { legacyCourseTitle: request.legacyCourseTitle },
    after: { directionName: direction.name, items: res.count },
  });

  return { ok: true, updated: res.count };
}
