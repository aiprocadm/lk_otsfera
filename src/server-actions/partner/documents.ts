'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { createPartnerDocument } from '@/lib/services/partner/documentUpload';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | {
      ok: false;
      error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage';
    };

const schema = z.object({ orderId: z.string().min(1), docType: z.string().min(1) });

export async function uploadPartnerDocument(formData: FormData): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'partner' || !session.partnerId) {
    return { ok: false, error: 'forbidden' };
  }

  const parsed = schema.safeParse({
    orderId: String(formData.get('orderId') ?? ''),
    docType: String(formData.get('docType') ?? 'other'),
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  const buffer = Buffer.from(await file.arrayBuffer());
  const res = await createPartnerDocument(prisma, session, {
    orderId: parsed.data.orderId,
    docType: parsed.data.docType,
    file: { name: file.name, size: file.size, mimeType: file.type, buffer },
  });
  if (!res.ok) return res;

  revalidatePath('/partner/documents');
  return { ok: true, documentId: res.documentId };
}
