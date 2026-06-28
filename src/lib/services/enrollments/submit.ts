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
 * (leader = manager). Result-based (§3): returns `{ ok: false, error }` with a
 * stable code (`'forbidden'` → 403, `'validation'` → 400) which the route maps to
 * HTTP. Organization linkage is scoped for partner (own orgs) and organization
 * (own memberships); manager/admin may target any org or none.
 */
export async function submitEnrollmentRequest(
  prisma: PrismaClient,
  session: SessionPayload,
  input: SubmitEnrollmentInput
): Promise<{ ok: true; request: EnrollmentRequest } | { ok: false; error: 'forbidden' | 'validation' }> {
  if (!canSubmitEnrollments(session)) return { ok: false, error: 'forbidden' };

  const studentName = input.studentName?.trim();
  const studentEmail = input.studentEmail?.trim();
  const courseTitle = input.courseTitle?.trim();
  if (!studentName || !studentEmail || !courseTitle) {
    return { ok: false, error: 'validation' };
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

  return { ok: true, request: created };
}
