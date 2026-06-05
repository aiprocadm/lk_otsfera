import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { managedOrgIds, getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';

/**
 * Manager-facing students service.
 *
 * Visibility is governed strictly by the per-org assignment branch of the
 * manager RBAC scope: a student appears here iff its `organizationId` is in
 * `session.managedOrgIds`. Unlike orders/documents, the per-order managerId
 * and historical-comments branches do *not* grant student visibility — only
 * the explicit OrganizationManager assignment does. This mirrors the design
 * in `services/manager/organizations`: a manager who once commented on an
 * org's order does not get to see that org's full employee roster.
 *
 * `managedOrgIds(session) === []` ⇒ `organizationId IN ()` ⇒ deny-all in
 * Prisma, which is the intended behaviour for an assignmentless manager.
 */

const ListStudentsOptionsSchema = z.object({
  session: z.custom<SessionPayload>(
    (v) => !!v && typeof v === 'object' && 'sub' in (v as object)
  ),
  q: z.string().optional(),
  take: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional()
});

export type ListStudentsOptions = z.input<typeof ListStudentsOptionsSchema>;

const LIST_INCLUDE = {
  organization: { select: { id: true, name: true } }
} satisfies Prisma.StudentInclude;

export type ManagerStudentRow = Prisma.StudentGetPayload<{ include: typeof LIST_INCLUDE }>;

export type ListStudentsResult = {
  rows: ManagerStudentRow[];
  nextCursor: string | null;
};

export async function listStudents(
  prisma: PrismaClient,
  optsRaw: ListStudentsOptions
): Promise<ListStudentsResult> {
  const opts = ListStudentsOptionsSchema.parse(optsRaw);
  const teamMode = await getCompanyTeamVisibility(prisma, opts.session.companyId);

  // Student has no companyId; in company-wide mode scope through its organization.
  const orgFilter: Prisma.StudentWhereInput = teamMode
    ? { organization: { companyId: opts.session.companyId ?? '__no_company__' } }
    : { organizationId: { in: managedOrgIds(opts.session) } };
  const filters: Prisma.StudentWhereInput[] = [orgFilter];
  if (opts.q) {
    filters.push({
      OR: [
        { name: { contains: opts.q, mode: 'insensitive' } },
        { email: { contains: opts.q, mode: 'insensitive' } }
      ]
    });
  }

  const rows = await prisma.student.findMany({
    where: { AND: filters },
    include: LIST_INCLUDE,
    orderBy: { id: 'desc' },
    take: opts.take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {})
  });

  const hasMore = rows.length > opts.take;
  const sliced = hasMore ? rows.slice(0, opts.take) : rows;
  const nextCursor = hasMore ? sliced[sliced.length - 1]!.id : null;
  return { rows: sliced, nextCursor };
}
