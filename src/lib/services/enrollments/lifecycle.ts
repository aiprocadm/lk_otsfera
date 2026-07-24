import type { PrismaClient, EnrollmentRequest } from '@prisma/client';
import { recordAudit } from '@/lib/auth/audit';

/**
 * Reviewer-side enrollment lifecycle (T5 → этап 2). Return the §3 Result
 * contract + audit; the route maps error codes to HTTP.
 *
 * Этап 2: заявка = шапка + позиции; approve/reject/markProvisioned работают по
 * шапке и зеркалируют статус во все не-отклонённые позиции (индивидуальные
 * переходы отдельных позиций — in_training/certificates_ready — PR-2).
 * Provisioning остаётся РУЧНЫМ во внешней LMS: markProvisioned фиксирует
 * externalStudentId, полученный оператором (пишется в позицию, когда она одна).
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
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: { status: 'approved', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id, status: 'pending' },
      data: { status: 'approved' }
    });
    return request;
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
  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: { status: 'rejected', rejectedReason: args.reason.trim() || 'Отклонено', reviewedByUserId: args.reviewerId, reviewedAt: new Date() }
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id },
      data: { status: 'rejected' }
    });
    return request;
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_rejected', entity: 'enrollment_request', entityId: r.id, after: { reason: updated.rejectedReason }
  });
  return { ok: true, request: updated };
}

export async function markProvisioned(
  prisma: PrismaClient,
  args: { id: string; reviewerId: string; externalStudentId?: string }
): Promise<
  | { ok: true; request: EnrollmentRequest }
  | { ok: false; error: 'not_found' | 'lifecycle_violation' | 'validation' }
> {
  const r = await loadRequest(prisma, args.id);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.status !== 'approved') return { ok: false, error: 'lifecycle_violation' };
  const sid = args.externalStudentId?.trim() || null;

  const itemCount = await prisma.enrollmentRequestItem.count({ where: { requestId: r.id } });
  // Одиночная заявка (включая все legacy): id из LMS обязателен, как раньше.
  // Для многопозиционной один общий id не имеет смысла — принимаем без него
  // (индивидуальные id по позициям — PR-2).
  if (itemCount <= 1 && !sid) return { ok: false, error: 'validation' };

  const updated = await prisma.$transaction(async (tx) => {
    const request = await tx.enrollmentRequest.update({
      where: { id: r.id },
      data: { status: 'provisioned', provisionedAt: new Date() }
    });
    await tx.enrollmentRequestItem.updateMany({
      where: { requestId: r.id, status: { not: 'rejected' } },
      data: { status: 'provisioned', ...(itemCount === 1 && sid ? { externalStudentId: sid } : {}) }
    });
    return request;
  });
  await recordAudit(prisma, {
    userId: args.reviewerId, action: 'enrollment_provisioned', entity: 'enrollment_request', entityId: r.id, after: { externalStudentId: sid }
  });
  return { ok: true, request: updated };
}
