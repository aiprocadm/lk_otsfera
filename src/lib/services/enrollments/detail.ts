import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReadDocument } from '@/lib/auth/policy';
import { recordPiiAccess } from '@/lib/pii/record';
import { itemDirectionNames, scopeWhere, type EnrollmentItemRow } from './list';

export type EnrollmentDetailItem = EnrollmentItemRow & {
  /** Документ удостоверения по направлению заявки — только если податель вправе его скачать. */
  certificateDocumentId: string | null;
};

export type EnrollmentDetail = {
  id: string;
  directionName: string;
  /** `У-43`: направления позиций — их может быть несколько в одной заявке. */
  directionNames: string[];
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
          directionId: true,
          direction: { select: { name: true } },
        },
      },
    },
  });
  if (!r) return { ok: false, error: 'not_found' };

  /**
   * Удостоверение ищется по паре «слушатель + направление ЭТОЙ позиции»
   * (`У-33`): в одной заявке направлений несколько, и по шапке человек с
   * высотных работ получил бы чужую корочку. С PR-3 «замок» направление у
   * позиции есть всегда, поэтому резерв из шапки больше не нужен.
   */
  const certKey = (studentId: string, directionId: string) => `${studentId}|${directionId}`;
  const certByKey = new Map<string, string>();
  const ready = r.items
    .filter((i) => i.status === 'certificates_ready' && i.studentId)
    .map((i) => ({ studentId: i.studentId as string, directionId: i.directionId }));
  if (ready.length) {
    const certs = await prisma.certificate.findMany({
      where: {
        studentId: { in: [...new Set(ready.map((p) => p.studentId))] },
        directionId: { in: [...new Set(ready.map((p) => p.directionId))] },
        documentId: { not: null },
      },
      orderBy: { issuedAt: 'desc' },
      select: { studentId: true, directionId: true, documentId: true },
    });
    for (const c of certs) {
      const key = certKey(c.studentId, c.directionId);
      if (!certByKey.has(key)) certByKey.set(key, c.documentId!);
    }
    // Право на документ проверяем один раз на уникальный documentId.
    const docs = await prisma.document.findMany({
      where: { id: { in: Array.from(new Set(certByKey.values())) } },
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
    for (const [key, docId] of certByKey) {
      if (!allowed.get(docId)) certByKey.delete(key);
    }
  }

  await recordPiiAccess(prisma, {
    session,
    context: 'enrollment_detail',
    subjectIds: [r.id],
  });

  const items = r.items.map(({ direction, directionId, ...i }) => ({
    ...i,
    directionName: direction.name,
    certificateDocumentId: i.studentId
      ? (certByKey.get(certKey(i.studentId, directionId)) ?? null)
      : null,
  }));

  return {
    ok: true,
    request: {
      id: r.id,
      // `У-36`: шапочного направления больше нет — подпись заявки берётся
      // из позиций. `legacyCourseTitle` остаётся для старых заявок, где
      // курс был вписан текстом и позиций может не быть вовсе.
      directionName: itemDirectionNames(items)[0] ?? r.legacyCourseTitle ?? '—',
      directionNames: itemDirectionNames(items),
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
      items,
    },
  };
}
