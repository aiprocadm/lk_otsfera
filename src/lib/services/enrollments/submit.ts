import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSubmitEnrollments, submitterRoleLabel } from './policy';
import { validateEnrollmentItems, type EnrollmentItemInput } from './validate';

export type SubmitEnrollmentInput = {
  directionId: string;
  organizationId?: string | null;
  note?: string | null;
  items: EnrollmentItemInput[];
};

export type SubmitEnrollmentResult =
  | { ok: true; request: EnrollmentRequest; itemCount: number; warnings: string[] }
  | { ok: false; error: 'forbidden' | 'validation'; messages?: string[] };

function activeOrgIds(session: SessionPayload): string[] {
  return (session.organizationMemberships ?? []).filter((m) => m.isActive).map((m) => m.organizationId);
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

  const directionId = input.directionId?.trim();
  if (!directionId) {
    return { ok: false, error: 'validation', messages: ['Выберите направление обучения'] };
  }
  const direction = await prisma.trainingDirection.findFirst({
    where: { id: directionId, isActive: true },
    select: { id: true }
  });
  if (!direction) {
    return { ok: false, error: 'validation', messages: ['Направление не найдено или неактивно'] };
  }

  const validated = validateEnrollmentItems(input.items ?? []);
  if (!validated.ok) return { ok: false, error: 'validation', messages: validated.errors };

  let organizationId = input.organizationId?.trim() || null;
  let partnerId: string | null = null;

  if (session.role === 'partner') {
    partnerId = session.partnerId ?? null;
    if (organizationId) {
      const org = await prisma.organization.findFirst({
        where: { id: organizationId, partnerId: partnerId ?? undefined },
        select: { id: true }
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
  const studentById = new Map<string, { name: string; email: string }>();
  if (studentIds.length) {
    if (!organizationId) return { ok: false, error: 'forbidden' };
    const students = await prisma.student.findMany({
      where: { id: { in: studentIds }, organizationId },
      select: { id: true, name: true, email: true }
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
        directionId,
        note: input.note?.trim() || null
      }
    });
    await tx.enrollmentRequestItem.createMany({
      data: validated.items.map((item) => {
        const snapshot = item.studentId ? studentById.get(item.studentId) : null;
        return {
          requestId: request.id,
          studentId: item.studentId,
          fullName: snapshot?.name ?? item.fullName,
          email: snapshot?.email ?? item.email,
          position: item.position,
          snils: item.snils,
          birthDate: item.birthDate,
          extra: item.extra
        };
      })
    });
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
      directionId,
      itemCount: validated.items.length,
      submitterRole: created.submitterRole
    }
  });

  return { ok: true, request: created, itemCount: validated.items.length, warnings: validated.warnings };
}
