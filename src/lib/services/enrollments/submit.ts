import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSubmitEnrollments, submitterRoleLabel } from './policy';
import { notifyManagersEnrollmentSubmitted } from './notify';
import { validateEnrollmentItems, type EnrollmentItemInput } from './validate';

export type SubmitEnrollmentInput = {
  organizationId?: string | null;
  note?: string | null;
  items: EnrollmentItemInput[];
};

export type SubmitEnrollmentResult =
  | { ok: true; request: EnrollmentRequest; itemCount: number; warnings: string[] }
  | { ok: false; error: 'forbidden' | 'validation'; messages?: string[] };

function activeOrgIds(session: SessionPayload): string[] {
  return (session.organizationMemberships ?? [])
    .filter((m) => m.isActive)
    .map((m) => m.organizationId);
}

/**
 * Подача заявки на обучение (этап 2, ФТ-2.1–2.2): шапка (направление из
 * справочника + примечание) и позиции-слушатели одной транзакцией.
 *
 * Роли — как раньше (partner/organization/manager/admin; leader = manager).
 * Скоупы: партнёр — только свои организации, организация — свои членства.
 * Каждый `studentId` обязан принадлежать выбранной организации — чужой id
 * это `forbidden`, а не validation (IDOR-защита §4). `messages` — русские
 * тексты для формы (только при validation).
 */
export async function submitEnrollmentRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  input: SubmitEnrollmentInput
): Promise<SubmitEnrollmentResult> {
  if (!canSubmitEnrollments(session)) return { ok: false, error: 'forbidden' };

  const validated = validateEnrollmentItems(input.items ?? []);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };

  // `У-33`: направление каждой позиции обязано быть из справочника. Без этой
  // проверки чужой id из тела запроса дошёл бы до внешнего ключа и упал бы
  // 500-й ошибкой вместо понятного сообщения (§3).
  //
  // `У-36`: раньше отсюда вычиталось направление шапки — оно проверялось
  // отдельно. Шапки больше нет, поэтому проверяются все направления позиций.
  const itemDirectionIds = [
    ...new Set(validated.items.map((i) => i.directionId).filter((id): id is string => !!id)),
  ];
  if (itemDirectionIds.length) {
    const found = await prisma.trainingDirection.findMany({
      where: { id: { in: itemDirectionIds }, isActive: true },
      select: { id: true },
    });
    if (found.length !== itemDirectionIds.length) {
      return {
        ok: false,
        error: 'validation',
        messages: ['Направление слушателя не найдено или неактивно'],
      };
    }
  }

  let organizationId = input.organizationId?.trim() || null;
  let partnerId: string | null = null;

  if (session.role === 'partner') {
    partnerId = session.partnerId ?? null;
    if (organizationId) {
      const org = await prisma.organization.findFirst({
        // partnerId отсутствует в where ⇒ Prisma не фильтрует по нему (ровно
        // прежняя семантика `partnerId: undefined`).
        where: { id: organizationId, ...(partnerId !== null ? { partnerId } : {}) },
        select: { id: true },
      });
      if (!org) return { ok: false, error: 'forbidden' };
    }
  } else if (session.role === 'organization') {
    const ids = activeOrgIds(session);
    if (organizationId) {
      if (!ids.includes(organizationId)) return { ok: false, error: 'forbidden' };
    } else {
      organizationId = session.organizationId ?? ids[0] ?? null;
    }
  }

  // Позиции «из сотрудников»: каждый studentId принадлежит выбранной организации;
  // ФИО/email копируются из Student на момент подачи (снимок).
  const studentIds = validated.items.map((i) => i.studentId).filter((id): id is string => !!id);
  const studentById = new Map<string, { name: string; email: string | null }>();
  if (studentIds.length) {
    if (!organizationId) return { ok: false, error: 'forbidden' };
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, organizationId },
      select: { id: true, name: true, email: true },
    });
    if (students.length !== new Set(studentIds).size) return { ok: false, error: 'forbidden' };
    for (const s of students) studentById.set(s.id, { name: s.name, email: s.email });
  }

  const created = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.create({
      data: {
        submittedByUserId: session.sub,
        submitterRole: submitterRoleLabel(session),
        partnerId,
        organizationId,
        note: input.note?.trim() || null,
      },
    });
    await tx.enrollmentRequestItem.createMany({
      data: validated.items.map((item) => {
        const snapshot = item.studentId ? studentById.get(item.studentId) : null;
        return {
          requestId: request.id,
          studentId: item.studentId,
          fullName: snapshot?.name ?? item.fullName,
          email: snapshot?.email ?? item.email,
          // `У-36`: направление позиции обязательно, шапочного поля больше нет.
          // Валидатор выше отвергает заявку с позицией без направления
          // («Слушатель N: не выбрано обучение»), поэтому сюда `null` не
          // доходит: запасное значение оставлено только ради типа.
          /* v8 ignore next -- недостижимо: позицию без направления отсекает validateEnrollmentItems (`У-36`) */
          directionId: item.directionId ?? '',
          position: item.position,
          snils: item.snils,
          birthDate: item.birthDate,
          extra: item.extra,
        };
      }),
    });

    // Этап 9 (ФТ-12.2): должность из заявки подхватывается в карточку
    // сотрудника — но НЕ затирает уже заполненную (`position: null` в фильтре):
    // актуальное значение из карточки старше по приоритету, чем присланное.
    // Принадлежность студентов организации проверена выше при загрузке снапшота.
    for (const item of validated.items) {
      if (!item.studentId || !item.position) continue;
      await tx.student.updateMany({
        where: { id: item.studentId, position: null },
        data: { position: item.position },
      });
    }

    return request;
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'enrollment_submitted',
    entity: 'enrollment_request',
    entityId: created.id,
    // Только счётчики и ссылки — ПДн слушателей в аудит не пишем.
    after: {
      organizationId,
      // `У-36`: вместо снятого шапочного поля — направления позиций, иначе
      // след «на что подавали» исчез бы из журнала.
      directionIds: itemDirectionIds,
      itemCount: validated.items.length,
      submitterRole: created.submitterRole,
    },
  });

  // ФТ-2.5: менеджерам организации о новой заявке (best-effort внутри notify.ts).
  await notifyManagersEnrollmentSubmitted(prisma, created);

  return {
    ok: true,
    request: created,
    itemCount: validated.items.length,
    warnings: validated.warnings,
  };
}
