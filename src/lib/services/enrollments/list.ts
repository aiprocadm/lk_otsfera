import type { PrismaClient, EnrollmentStatus, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { canReviewEnrollments } from './policy';

export type EnrollmentRow = {
  id: string;
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  status: EnrollmentStatus;
  organizationId: string | null;
  organizationName: string | null;
  partnerName: string | null;
  submitterRole: string;
  submittedByName: string;
  externalStudentId: string | null;
  rejectedReason: string | null;
  note: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

export type ListEnrollmentsOptions = {
  status?: EnrollmentStatus;
  search?: string;
  cursor?: string;
  take?: number;
};

export type ListEnrollmentsResult = { rows: EnrollmentRow[]; nextCursor: string | null };

/**
 * Visibility: reviewers (manager/leader/admin) see the whole team queue; a partner
 * sees its own (partnerId); an organization sees its orgs' requests or ones it
 * submitted; everyone else sees only what they submitted.
 */
function scopeWhere(session: SessionPayload): Prisma.EnrollmentRequestWhereInput {
  if (canReviewEnrollments(session)) return {};
  if (session.role === 'partner') return { partnerId: session.partnerId ?? '__none__' };
  if (session.role === 'organization') {
    const ids = (session.organizationMemberships ?? []).filter((m) => m.isActive).map((m) => m.organizationId);
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
        { studentName: { contains: opts.search, mode: 'insensitive' } },
        { studentEmail: { contains: opts.search, mode: 'insensitive' } },
        { courseTitle: { contains: opts.search, mode: 'insensitive' } }
      ]
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
      submittedByUser: { select: { name: true } }
    }
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return {
    rows: page.map((r) => ({
      id: r.id,
      studentName: r.studentName,
      studentEmail: r.studentEmail,
      courseTitle: r.courseTitle,
      status: r.status,
      organizationId: r.organizationId,
      organizationName: r.organization?.name ?? null,
      partnerName: r.partner?.name ?? null,
      submitterRole: r.submitterRole,
      submittedByName: r.submittedByUser.name,
      externalStudentId: r.externalStudentId,
      rejectedReason: r.rejectedReason,
      note: r.note,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null
  };
}
