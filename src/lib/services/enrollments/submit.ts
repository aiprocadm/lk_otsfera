import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordAudit } from '@/lib/auth/audit';
import { canSubmitEnrollments, submitterRoleLabel } from './policy';

export type SubmitEnrollmentInput = {
  studentName: string;
  studentEmail: string;
  courseTitle: string;
  organizationId?: string | null;
  note?: string | null;
};

function activeOrgIds(session: SessionPayload): string[] {
  return (session.organizationMemberships ?? []).filter((m) => m.isActive).map((m) => m.organizationId);
}

/**
 * Submit an enrollment request. Allowed for partner/organization/manager/admin
 * (leader = manager). Throw-based (mapped to HTTP by the route): VALIDATION → 400,
 * FORBIDDEN → 403. Organization linkage is scoped for partner (own orgs) and
 * organization (own memberships); manager/admin may target any org or none.
 */
export async function submitEnrollmentRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  input: SubmitEnrollmentInput
): Promise<EnrollmentRequest> {
  if (!canSubmitEnrollments(session)) throw new Error('FORBIDDEN: role cannot submit enrollment requests');

  const studentName = input.studentName?.trim();
  const studentEmail = input.studentEmail?.trim();
  const courseTitle = input.courseTitle?.trim();
  if (!studentName || !studentEmail || !courseTitle) {
    throw new Error('VALIDATION: studentName, studentEmail and courseTitle are required');
  }

  let organizationId = input.organizationId?.trim() || null;
  let partnerId: string | null = null;

  if (session.role === 'partner') {
    partnerId = session.partnerId ?? null;
    if (organizationId) {
      const org = await prisma.organization.findFirst({
        where: { id: organizationId, partnerId: partnerId ?? undefined },
        select: { id: true }
      });
      if (!org) throw new Error('FORBIDDEN: organization not in partner scope');
    }
  } else if (session.role === 'organization') {
    const ids = activeOrgIds(session);
    if (organizationId) {
      if (!ids.includes(organizationId)) throw new Error('FORBIDDEN: organization not in your memberships');
    } else {
      organizationId = session.organizationId ?? ids[0] ?? null;
    }
  }

  const created = await prisma.enrollmentRequest.create({
    data: {
      submittedByUserId: session.sub,
      submitterRole: submitterRoleLabel(session),
      partnerId,
      organizationId,
      studentName,
      studentEmail,
      courseTitle,
      note: input.note?.trim() || null
    }
  });

  await recordAudit(prisma, {
    userId: session.sub,
    action: 'enrollment_submitted',
    entity: 'enrollment_request',
    entityId: created.id,
    after: { organizationId, studentEmail, courseTitle, submitterRole: created.submitterRole }
  });

  return created;
}
