import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { recordPiiAccess } from '@/lib/pii/record';
import { scopeWhere, type EnrollmentItemRow } from './list';

export type EnrollmentDetailItem = EnrollmentItemRow & {
  /** Документ удостоверения по направлению заявки — только если податель вправе его скачать. */
  certificateDocumentId: string | null;
};

export type EnrollmentDetail = {
  id: string;
  directionName: string;
  status: EnrollmentItemRow['status'];
  organizationName: string | null;
  partnerName: string | null;
  submittedByName: string;
  submitterRole: string;
  note: string | null;
  rejectedReason: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
  provisionedAt: Date | null;
  items: EnrollmentDetailItem[];
};

/**
 * Деталка заявки для подателя (этап 2 PR-2, ФТ-2.3): позиции с индивидуальными
 * статусами + прямые ссылки на удостоверения (§5 спеки — реестр удостоверений
 * это Модуль 6/этап 3, здесь только ссылка при наличии Certificate.documentId
 * по направлению заявки). Скоуп — тот же, что у списка (`scopeWhere`); чужая
 * заявка неотличима от несуществующей (not_found).
 *
 * Ссылка на удостоверение отдаётся только если у зрителя есть право на сам
 * документ (`canReadDocument`) — иначе кнопка вела бы в 403 (например, партнёр
 * и org-канальный документ).
 */
export async function getEnrollmentRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  id: string
): Promise<{ ok: true; request: EnrollmentDetail } | { ok: false; error: 'not_found' }> {
  const r = await prisma.enrollmentRequest.findFirst({
    where: { AND: [{ id }, scopeWhere(session)] },
    include: {
      organization: { select: { name: true } },
      partner: { select: { name: true } },
      submittedByUser: { select: { name: true } },
      direction: { select: { name: true } },
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          studentId: true,
          fullName: true,
          email: true,
          position: true,
          snils: true,
          birthDate: true,
          extra: true,
          status: true,
          externalStudentId: true,
        },
      },
    },
  });
  if (!r) return { ok: false, error: 'not_found' };

  // Удостоверения: по (studentId, направление заявки), свежайшее с документом.
  const certByStudent = new Map<string, string>();
  const readyStudentIds = r.directionId
    ? r.items
        .filter((i) => i.status === 'certificates_ready' && i.studentId)
        .map((i) => i.studentId as string)
    : [];
  if (readyStudentIds.length) {
    const certs = await prisma.certificate.findMany({
      where: {
        studentId: { in: readyStudentIds },
        directionId: r.directionId!,
        documentId: { not: null },
      },
      orderBy: { issuedAt: 'desc' },
      select: { studentId: true, documentId: true },
    });
    for (const c of certs) {
      if (!certByStudent.has(c.studentId)) certByStudent.set(c.studentId, c.documentId!);
    }
    // Право на документ проверяем один раз на уникальный documentId.
    const docs = await prisma.document.findMany({
      where: { id: { in: Array.from(new Set(certByStudent.values())) } },
      select: {
        id: true,
        orderId: true,
        companyId: true,
        counterpartyType: true,
        counterpartyId: true,
        order: { select: { companyId: true } },
      },
    });
    const allowed = new Map<string, boolean>();
    for (const d of docs) {
      allowed.set(
        d.id,
        await canReadDocument(session, {
          ...d,
          counterpartyType: d.counterpartyType ?? undefined,
          counterpartyId: d.counterpartyId ?? undefined,
          order: d.order?.companyId ? { companyId: d.order.companyId } : null,
        })
      );
    }
    for (const [studentId, docId] of certByStudent) {
      if (!allowed.get(docId)) certByStudent.delete(studentId);
    }
  }

  await recordPiiAccess(prisma, {
    session,
    context: 'enrollment_detail',
    subjectIds: [r.id],
  });

  return {
    ok: true,
    request: {
      id: r.id,
      directionName: r.direction?.name ?? r.legacyCourseTitle ?? '—',
      status: r.status,
      organizationName: r.organization?.name ?? null,
      partnerName: r.partner?.name ?? null,
      submittedByName: r.submittedByUser.name,
      submitterRole: r.submitterRole,
      note: r.note,
      rejectedReason: r.rejectedReason,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
      provisionedAt: r.provisionedAt,
      items: r.items.map((i) => ({
        ...i,
        certificateDocumentId: i.studentId ? (certByStudent.get(i.studentId) ?? null) : null,
      })),
    },
  };
}
