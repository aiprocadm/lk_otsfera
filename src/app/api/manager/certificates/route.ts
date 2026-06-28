import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { createCertificate, issueFromOrderItem } from '@/lib/services/training/certificates';

function mapError(error: string): number {
  switch (error) {
    case 'forbidden': return 403;
    case 'not_found': return 404;
    default: return 400; // validation
  }
}

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const body = await req.json() as {
    orderItemId?: string;
    studentId?: string;
    directionId?: string;
    number: string;
    issuedAt: string;
    validUntil?: string;
    documentId?: string;
    comment?: string;
  };

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
