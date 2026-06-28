import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';
import type { EnrollmentStatus } from '@prisma/client';

const STATUSES = ['pending', 'approved', 'rejected', 'provisioned'];

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSubmitEnrollments(session)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const res = await submitEnrollmentRequest(prisma, session, {
    studentName: String(body.studentName ?? ''),
    studentEmail: String(body.studentEmail ?? ''),
    courseTitle: String(body.courseTitle ?? ''),
    organizationId: body.organizationId ?? null,
    note: body.note ?? null
  });
  if (!res.ok) {
    const status = res.error === 'validation' ? 400 : 403;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ id: res.request.id }, { status: 201 });
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
