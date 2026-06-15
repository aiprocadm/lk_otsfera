import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { canReviewEnrollments } from '@/lib/services/enrollments/policy';
import { approveEnrollment, rejectEnrollment, markProvisioned } from '@/lib/services/enrollments/lifecycle';

type Params = { params: Promise<{ id: string }> };

function mapError(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (msg.startsWith('VALIDATION')) return NextResponse.json({ error: msg }, { status: 400 });
  if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: msg }, { status: 404 });
  if (msg.startsWith('LIFECYCLE_VIOLATION')) return NextResponse.json({ error: msg }, { status: 409 });
  throw err;
}

export async function PATCH(req: Request, { params }: Params) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReviewEnrollments(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  const reviewerId = session.sub;

  try {
    if (action === 'approve') {
      const r = await approveEnrollment(prisma, { id, reviewerId });
      return NextResponse.json({ request: r });
    }
    if (action === 'reject') {
      const r = await rejectEnrollment(prisma, { id, reviewerId, reason: String(body?.reason ?? '') });
      return NextResponse.json({ request: r });
    }
    if (action === 'markProvisioned') {
      const r = await markProvisioned(prisma, { id, reviewerId, externalStudentId: String(body?.externalStudentId ?? '') });
      return NextResponse.json({ request: r });
    }
    return NextResponse.json({ error: 'Invalid action. Use approve|reject|markProvisioned' }, { status: 400 });
  } catch (err) {
    return mapError(err);
  }
}
