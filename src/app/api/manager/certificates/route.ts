import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/api/http';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { createCertificate, issueFromOrderItem } from '@/lib/services/training/certificates';

function mapError(error: string): number {
  switch (error) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    default:
      return 400; // validation
  }
}

/**
 * Схема — только ФОРМА входа (типы полей, повторяет прежний TS-каст тела).
 * Доменные проверки (существование позиции/студента/направления, даты) —
 * в сервисе; его коды ошибок не подменяются.
 */
const postBodySchema = z.object({
  orderItemId: z.string().optional(),
  studentId: z.string().optional(),
  directionId: z.string().optional(),
  number: z.string(),
  issuedAt: z.string(),
  validUntil: z.string().optional(),
  documentId: z.string().optional(),
  comment: z.string().optional(),
});

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const parsed = await parseJsonBody(req, postBodySchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.orderItemId) {
    const res = await issueFromOrderItem(prisma, session, {
      orderItemId: body.orderItemId,
      number: body.number,
      issuedAt: new Date(body.issuedAt),
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      documentId: body.documentId ?? null,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
    return NextResponse.json({ certificate: res.certificate }, { status: 201 });
  }

  if (!body.studentId || !body.directionId) {
    return NextResponse.json({ error: 'validation' }, { status: 400 });
  }

  const res = await createCertificate(prisma, session, {
    studentId: body.studentId,
    directionId: body.directionId,
    number: body.number,
    issuedAt: new Date(body.issuedAt),
    validUntil: body.validUntil ? new Date(body.validUntil) : null,
    orderItemId: null,
    documentId: body.documentId ?? null,
    comment: body.comment ?? null,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: mapError(res.error) });
  return NextResponse.json({ certificate: res.certificate }, { status: 201 });
}
