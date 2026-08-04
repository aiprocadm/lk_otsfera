'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { createOrganizationDocument } from '@/lib/services/organization/documentUpload';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage';
    };

const schema = z.object({
  organizationId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  docType: z.string().min(1),
});

export async function uploadOrganizationDocument(
  formData: FormData
): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const rawOrderId = formData.get('orderId');
  const parsed = schema.safeParse({
    organizationId: String(formData.get('organizationId') ?? ''),
    orderId: rawOrderId ? String(rawOrderId) : undefined,
    docType: String(formData.get('docType') ?? 'other'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const res = await createOrganizationDocument(prisma, session, {
    organizationId: parsed.data.organizationId,
    orderId: parsed.data.orderId ?? null,
    docType: parsed.data.docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer },
  });
  if (!res.ok) return res;

  revalidatePath('/organization/documents');
  return { ok: true, documentId: res.documentId };
}
