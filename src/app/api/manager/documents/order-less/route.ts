import { NextResponse } from 'next/server';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createManagerOrderLessDocument } from '@/lib/services/manager/uploads';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  invalid_recipient: 422,
  too_large: 413,
  invalid_mime: 415,
  storage: 502
};

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const fd = await req.formData().catch(() => null);
  if (!fd) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const counterpartyType = String(fd.get('counterpartyType') ?? '');
  const counterpartyId = String(fd.get('counterpartyId') ?? '');
  const docType = String(fd.get('docType') ?? 'other');
  const file = fd.get('file');

  if (
    (counterpartyType !== 'organization' && counterpartyType !== 'partner') ||
    !counterpartyId
  ) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await createManagerOrderLessDocument(prisma, session, {
    counterparty: { type: counterpartyType as 'organization' | 'partner', id: counterpartyId },
    docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  }
  return NextResponse.json({ documentId: result.documentId });
}
