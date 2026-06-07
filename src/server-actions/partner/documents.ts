'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyManagers } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' };

const schema = z.object({ orderId: z.string().min(1), docType: z.string().min(1) });

export async function uploadPartnerDocument(formData: FormData): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'partner' || !session.partnerId) {
    return { ok: false, error: 'forbidden' };
  }

  const parsed = schema.safeParse({
    orderId: String(formData.get('orderId') ?? ''),
    docType: String(formData.get('docType') ?? 'other')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { id: true, partnerId: true, orderNumber: true, title: true }
  });
  if (!order || order.partnerId !== session.partnerId) {
    return { ok: false, error: 'not_found' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'partner', id: session.partnerId },
    orderId: order.id,
    direction: 'incoming',
    docType: parsed.data.docType,
    uploadedById: session.sub,
    source: 'partner',
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });
  if (!persisted.ok) return persisted;

  try {
    const partner = await prisma.partner.findUnique({
      where: { id: session.partnerId },
      select: { name: true }
    });
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_partner',
      payload: { partnerName: partner?.name ?? 'партнёр', documentName: file.name, documentType: parsed.data.docType }
    });
  } catch (err) {
    console.warn('[uploadPartnerDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  revalidatePath('/partner/documents');
  return { ok: true, documentId: persisted.documentId };
}
