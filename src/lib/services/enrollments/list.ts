import type { PrismaClient, EnrollmentStatus, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { canReviewEnrollments } from './policy';

export type EnrollmentItemRow = {
  id: string;
  studentId: string | null;
  fullName: string;
  email: string;
  position: string | null;
  snils: string | null;
  birthDate: Date | null;
  extra: string | null;
  status: EnrollmentStatus;
  externalStudentId: string | null;
  /**
   * `У-43`: направление ЭТОЙ позиции. С PR-3 «замок» оно обязательно —
   * позиции без направления в базе больше нет.
   */
  directionName: string;
};

/** `У-43`: список различных направлений заявки в порядке появления позиций. */
export function itemDirectionNames(items: Pick<EnrollmentItemRow, 'directionName'>[]): string[] {
  return [...new Set(items.map((i) => i.directionName))];
}

export type EnrollmentRow = {
  id: string;
  /** Имя направления из справочника; для legacy-заявок — сохранённый текст. */
  directionName: string;
  /** `У-43`: направления позиций — их может быть несколько в одной заявке. */
  directionNames: string[];
  studentCount: number;
  firstStudentName: string | null;
  items: EnrollmentItemRow[];
  status: EnrollmentStatus;
  organizationId: string | null;
  organizationName: string | null;
  partnerName: string | null;
  submitterRole: string;
  submittedByName: string;
  rejectedReason: string | null;
  note: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

// Фильтры списка: «ключа нет» и «ключ = undefined» — одно и то же (не фильтровать).
export type ListEnrollmentsOptions = {
  status?: EnrollmentStatus | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
  take?: number | undefined;
};

export type ListEnrollmentsResult = { rows: EnrollmentRow[]; nextCursor: string | null };

/**
 * Visibility: reviewers (manager/leader/admin) see the whole team queue; a partner
 * sees its own (partnerId); an organization sees its orgs' requests or ones it
 * submitted; everyone else sees only what they submitted. Экспортируется для
 * деталки (detail.ts) — один скоуп на список и деталку.
 */
export function scopeWhere(session: SessionPayload): Prisma.EnrollmentRequestWhereInput {
  if (canReviewEnrollments(session)) return {};
  if (session.role === 'partner') return { partnerId: session.partnerId ?? '__none__' };
  if (session.role === 'organization') {
    const ids = (session.organizationMemberships ?? [])
      .filter((m) => m.isActive)
      .map((m) => m.organizationId);
    return { OR: [{ organizationId: { in: ids } }, { submittedByUserId: session.sub }] };
  }
  return { submittedByUserId: session.sub };
}

export async function listEnrollmentRequests(
  prisma: PrismaClient,
  session: SessionPayload,
  opts: ListEnrollmentsOptions = {}
): Promise<ListEnrollmentsResult> {
  const take = opts.take ?? 20;
  const and: Prisma.EnrollmentRequestWhereInput[] = [scopeWhere(session)];
  if (opts.status) and.push({ status: opts.status });
  if (opts.search) {
    and.push({
      OR: [
        // `У-36`: направление живёт в позициях, шапочного поля больше нет.
        { items: { some: { direction: { name: { contains: opts.search, mode: 'insensitive' } } } } },
        { legacyCourseTitle: { contains: opts.search, mode: 'insensitive' } },
        { items: { some: { fullName: { contains: opts.search, mode: 'insensitive' } } } },
        { items: { some: { email: { contains: opts.search, mode: 'insensitive' } } } },
      ],
    });
  }

  const rows = await prisma.enrollmentRequest.findMany({
    where: { AND: and },
    orderBy: { createdAt: 'desc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
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
          direction: { select: { name: true } },
        },
      },
    },
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  await recordPiiAccess(prisma, {
    session,
    context: 'enrollments_list',
    subjectIds: page.map((r) => r.id),
    meta: { take, cursor: opts.cursor !== undefined },
  });

  return {
    rows: page.map((r) => {
      const items = r.items.map(({ direction, ...i }) => ({
        ...i,
        directionName: direction.name,
      }));
      return {
        id: r.id,
        // `У-36`: подпись берётся из позиций; `legacyCourseTitle` — резерв
        // для старых заявок, где курс вписан текстом.
        directionName: itemDirectionNames(items)[0] ?? r.legacyCourseTitle ?? '—',
        directionNames: itemDirectionNames(items),
        studentCount: items.length,
        firstStudentName: items[0]?.fullName ?? null,
        items,
        status: r.status,
        organizationId: r.organizationId,
        organizationName: r.organization?.name ?? null,
        partnerName: r.partner?.name ?? null,
        submitterRole: r.submitterRole,
        submittedByName: r.submittedByUser.name,
        rejectedReason: r.rejectedReason,
        note: r.note,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
      };
    }),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}
