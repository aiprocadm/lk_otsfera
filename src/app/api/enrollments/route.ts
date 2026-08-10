import { NextResponse } from 'next/server';
import { EnrollmentStatus } from '@prisma/client';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { submitEnrollmentRequest } from '@/lib/services/enrollments/submit';
import { listEnrollmentRequests } from '@/lib/services/enrollments/list';
import { canSubmitEnrollments } from '@/lib/services/enrollments/policy';

// Дедупликация C2: источник — prisma-enum EnrollmentStatus (schema.prisma).
const STATUSES: string[] = Object.values(EnrollmentStatus);

/** Позиция из тела запроса: только строковые поля, ничего не интерпретируем. */
function readItem(raw: unknown) {
  const rec = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    studentId: str(rec.studentId),
    // У-33: направление у каждой позиции — мастер шлёт своё на каждого
    // слушателя; проверяет его сервис, роут только пробрасывает.
    directionId: str(rec.directionId),
    fullName: str(rec.fullName),
    email: str(rec.email),
    position: str(rec.position),
    snils: str(rec.snils),
    birthDate: str(rec.birthDate),
    extra: str(rec.extra),
  };
}

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canSubmitEnrollments(session))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Схема — только «тело — JSON-объект»: роут намеренно ничего не
  // интерпретирует (не-строки → null, items не-массив → []) — это
  // закреплено тестами, решение принимает валидатор сервиса.
  const parsed = await parseJsonBody(req, z.record(z.unknown()));
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;
  const res = await submitEnrollmentRequest(prisma, session, {
    directionId: String(body.directionId ?? ''),
    organizationId: (body.organizationId ?? null) as string | null,
    note: (body.note ?? null) as string | null,
    items: Array.isArray(body.items) ? body.items.map(readItem) : [],
  });
  if (!res.ok) {
    const status = res.error === 'validation' ? 400 : 403;
    return NextResponse.json({ error: res.error, messages: res.messages ?? [] }, { status });
  }
  return NextResponse.json(
    { id: res.request.id, itemCount: res.itemCount, warnings: res.warnings },
    { status: 201 }
  );
}

export async function GET(req: Request) {
  const disabled = notFoundIfDisabled('enrollment_requests');
  if (disabled) return disabled;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = new URL(req.url).searchParams;
  const statusRaw = sp.get('status');
  const status =
    statusRaw && STATUSES.includes(statusRaw) ? (statusRaw as EnrollmentStatus) : undefined;
  const result = await listEnrollmentRequests(prisma, session, {
    status,
    search: sp.get('q') ?? undefined,
    cursor: sp.get('cursor') ?? undefined,
  });
  return NextResponse.json(result);
}
