import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Reviewer-side enrollment lifecycle (T5). Throw-based + audit, mapped to HTTP by
 * the route. Transitions: pending → approved → provisioned; pending → rejected.
 * Provisioning is MANUAL into the external LMS — markProvisioned only records the
 * externalStudentId the operator obtained there.
 */
async function loadRequest(prisma: PrismaClient, id: string) {
  const r = await prisma.enrollmentRequest.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!r) throw new Error('NOT_FOUND: enrollment request');
  return r;
}

export async function approveEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string }
): Promise<EnrollmentRequest> {
  const r = await loadRequest(prisma, args.id);
  if (r.status !== 'pending') throw new Error(`LIFECYCLE_VIOLATION: cannot approve from ${r.status}`);
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'approved', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_approved', entity: 'enrollment_request', entityId: r.id, after: { status: 'approved' }
  });
  return updated;
}

export async function rejectEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; reason: string }
): Promise<EnrollmentRequest> {
  const r = await loadRequest(prisma, args.id);
  if (r.status === 'provisioned' || r.status === 'rejected') {
    throw new Error(`LIFECYCLE_VIOLATION: cannot reject from ${r.status}`);
  }
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отклонено', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_rejected', entity: 'enrollment_request', entityId: r.id, after: { reason: updated.rejectedReason }
  });
  return updated;
}

export async function markProvisioned(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; externalStudentId: string }
): Promise<EnrollmentRequest> {
  const r = await loadRequest(prisma, args.id);
  if (r.status !== 'approved') throw new Error(`LIFECYCLE_VIOLATION: cannot provision from ${r.status}`);
  const sid = args.externalStudentId?.trim();
  if (!sid) throw new Error('VALIDATION: externalStudentId is required to mark provisioned');
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'provisioned', externalStudentId: sid, provisionedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_provisioned', entity: 'enrollment_request', entityId: r.id, after: { externalStudentId: sid }
  });
  return updated;
}
