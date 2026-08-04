import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { canReviewEnrollments } from '@/lib/services/enrollments/policy';
import {
  advanceEnrollmentItems,
  approveEnrollment,
  rejectEnrollment,
  markProvisioned,
} from '@/lib/services/enrollments/lifecycle';

type Params = { params: Promise<{ id: string }> };

const statusFor = (error: 'not_found' | 'lifecycle_violation' | 'validation'): number =>
  error === 'validation' ? 400 : error === 'not_found' ? 404 : 409;

export async function PATCH(req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReviewEnrollments(session))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await params;
  // Схема — только «тело — JSON-объект»: проверка action и формы itemIds
  // остаётся в роуте (код 'validation' закреплён тестами), String()-коэрции
  // reason/externalStudentId — тоже.
  const parsed = await parseJsonBody(req, z.record(z.unknown()));
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const action = body.action;
  const reviewerId = session.sub;

  if (action === 'approve') {
    const r = await approveEnrollment(prisma, { id, reviewerId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request });
  }
  if (action === 'reject') {
    const r = await rejectEnrollment(prisma, {
      id,
      reviewerId,
      reason: String(body.reason ?? ''),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request });
  }
  if (action === 'markProvisioned') {
    const r = await markProvisioned(prisma, {
      id,
      reviewerId,
      externalStudentId: String(body.externalStudentId ?? ''),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request });
  }
  if (action === 'markInTraining' || action === 'markCertificatesReady') {
    const rawIds = body.itemIds;
    if (rawIds !== undefined && !Array.isArray(rawIds)) {
      return NextResponse.json({ error: 'validation' }, { status: 400 });
    }
    const itemIds = rawIds === undefined ? undefined : (rawIds as unknown[]).map((v) => String(v));
    const r = await advanceEnrollmentItems(prisma, {
      id,
      reviewerId,
      target: action === 'markInTraining' ? 'in_training' : 'certificates_ready',
      // exactOptionalPropertyTypes: сервис различает «ключа нет» и «ключ = undefined».
      ...(itemIds !== undefined ? { itemIds } : {}),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: statusFor(r.error) });
    return NextResponse.json({ request: r.request, movedCount: r.movedCount });
  }
  return NextResponse.json(
    {
      error:
        'Invalid action. Use approve|reject|markProvisioned|markInTraining|markCertificatesReady',
    },
    { status: 400 }
  );
}
