import { NextResponse } from 'next/server';
import { z } from 'zod';
import { formFields, readFile, readMultipart } from '@/lib/api/multipart';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { createManagerOrderLessDocument } from '@/lib/services/manager/uploads';
import { notFoundIfDisabled } from '@/lib/featureFlags';

const FIELDS = z.object({
  counterpartyType: z.coerce.string().default(''),
  counterpartyId: z.coerce.string().default(''),
  docType: z.coerce.string().default('other'),
});

const STATUS: Record<string, number> = {
  forbidden: 403,
  not_found: 404,
  invalid_recipient: 422,
  too_large: 413,
  invalid_mime: 415,
  storage: 502,
};

export async function POST(req: Request) {
  const disabled = notFoundIfDisabled('manager_cabinet');
  if (disabled) return disabled;

  const session = await requireManager();
  const fd = await readMultipart(req);
  if (!fd) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const { counterpartyType, counterpartyId, docType } = formFields(fd, FIELDS);

  if ((counterpartyType !== 'organization' && counterpartyType !== 'partner') || !counterpartyId) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const file = await readFile(fd, 'file');
  if (file === null) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const result = await createManagerOrderLessDocument(prisma, session, {
    counterparty: { type: counterpartyType as 'organization' | 'partner', id: counterpartyId },
    docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer: file.buffer },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: STATUS[result.error] ?? 400 });
  }
  return NextResponse.json({ documentId: result.documentId });
}
