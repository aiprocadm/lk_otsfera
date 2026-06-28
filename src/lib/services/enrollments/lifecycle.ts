import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Reviewer-side enrollment lifecycle (T5). Return the §3 Result contract + audit;
 * the route maps error codes to HTTP. Transitions: pending → approved →
 * provisioned; pending → rejected. Provisioning is MANUAL into the external LMS —
 * markProvisioned only records the externalStudentId the operator obtained there.
 */
async function loadRequest(prisma: PrismaClient, id: string) {
  return prisma.enrollmentRequest.findUnique({ where: { id }, select: { id: true, status: true } });
}

export async function approveEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string }
): Promise<{ ok: true; request: EnrollmentRequest } | { ok: false; error: 'not_found' | 'lifecycle_violation' }> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'pending') return { ok: false, error: 'lifecycle_violation' };
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'approved', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_approved', entity: 'enrollment_request', entityId: r.id, after: { status: 'approved' }
  });
  return { ok: true, request: updated };
}

export async function rejectEnrollment(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; reason: string }
): Promise<{ ok: true; request: EnrollmentRequest } | { ok: false; error: 'not_found' | 'lifecycle_violation' }> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status === 'provisioned' || r.status === 'rejected') {
    return { ok: false, error: 'lifecycle_violation' };
  }
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отклонено', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_rejected', entity: 'enrollment_request', entityId: r.id, after: { reason: updated.rejectedReason }
  });
  return { ok: true, request: updated };
}

export async function markProvisioned(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; externalStudentId: string }
): Promise<
  | { ok: true; request: EnrollmentRequest }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' | 'validation' }
> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'approved') return { ok: false, error: 'lifecycle_violation' };
  const sid = args.externalStudentId?.trim();
  if (!sid) return { ok: false, error: 'validation' };
  const updated = await prisma.enrollmentRequest.update({
    where: { id: r.id },
    data: { status: 'provisioned', externalStudentId: sid, provisionedAt: new Date() }
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_provisioned', entity: 'enrollment_request', entityId: r.id, after: { externalStudentId: sid }
  });
  return { ok: true, request: updated };
}
