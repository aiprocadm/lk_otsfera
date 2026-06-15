import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import type { EnrollmentStatus } from '@prisma/client';

const STATUSES = ['pending', 'approved', 'rejected', 'provisioned'];

function mapError(err: unknown): NextResponse {
  const msg = err instanceof Error ? err.message : 'Unknown error';
  if (msg.startsWith('VALIDATION')) return NextResponse.json({ error: msg }, { status: 400 });
  if (msg.startsWith('FORBIDDEN')) return NextResponse.json({ error: msg }, { status: 403 });
  if (msg.startsWith('NOT_FOUND')) return NextResponse.json({ error: msg }, { status: 404 });
  throw err;
}

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSubmitEnrollments(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  try {
    const created = await submitEnrollmentRequest(prisma, session, {
      studentName: String(body.studentName ?? ''),
      studentEmail: String(body.studentEmail ?? ''),
      courseTitle: String(body.courseTitle ?? ''),
      organizationId: body.organizationId ?? null,
      note: body.note ?? null
    });
    return NextResponse.json({ id: created.id }, { status: 201 });
  } catch (err) {
    return mapError(err);
  }
}

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const statusRaw = sp.get('status');
  const status = statusRaw && STATUSES.includes(statusRaw) ? (statusRaw as EnrollmentStatus) : undefined;
  const result = await listEnrollmentRequests(prisma, session, {
    status,
    search: sp.get('q') ?? undefined,
    cursor: sp.get('cursor') ?? undefined
  });
  return NextResponse.json(result);
}
