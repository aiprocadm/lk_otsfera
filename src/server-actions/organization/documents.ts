'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyManagers, notifyManagersOrderLess } from '@/lib/notifications';
import { persistUploadedDocument } from '@/lib/services/documents/upload-core';

export type UploadDocumentResult =
  | { ok: true; documentId: string }
  | { ok: false; error: 'validation' | 'forbidden' | 'not_found' | 'too_large' | 'invalid_mime' | 'storage' };

const schema = z.object({
  organizationId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  docType: z.string().min(1)
});

export async function uploadOrganizationDocument(formData: FormData): Promise<UploadDocumentResult> {
  const session = await getSession();
  if (!session || session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const rawOrderId = formData.get('orderId');
  const parsed = schema.safeParse({
    organizationId: String(formData.get('organizationId') ?? ''),
    orderId: rawOrderId ? String(rawOrderId) : undefined,
    docType: String(formData.get('docType') ?? 'other')
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'validation' };

  // Membership: user must be an active member of the target org.
  const membership = await prisma.organizationUser.findFirst({
    where: { organizationId: parsed.data.organizationId, userId: session.sub, isActive: true },
    select: { id: true }
  });
  if (!membership) return { ok: false, error: 'forbidden' };

  if (!parsed.data.orderId) {
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { name: true, companyId: true }
    });
    if (!org?.companyId) return { ok: false, error: 'not_found' };

    const buffer = Buffer.from(await file.arrayBuffer());
    const persisted = await persistUploadedDocument(prisma, {
      counterparty: { type: 'organization', id: parsed.data.organizationId },
      orderId: null,
      companyId: org.companyId,
      direction: 'incoming',
      docType: parsed.data.docType,
      uploadedById: session.sub,
      source: 'organization',
      file: { name: file.name, size: file.size, mimeType: file.type, buffer }
    });
    if (!persisted.ok) return persisted;

    try {
      await notifyManagersOrderLess(prisma, {
        organizationId: parsed.data.organizationId,
        orgName: org.name,
        documentName: file.name,
        documentType: parsed.data.docType
      });
    } catch (err) {
      console.warn('[uploadOrganizationDocument] order-less notify failed', {
        documentId: persisted.documentId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
    revalidatePath('/organization/documents');
    return { ok: true, documentId: persisted.documentId };
  }

  // Order must belong to that org (silent not_found otherwise — no existence leak).
  const order = await prisma.order.findUnique({
    where: { id: parsed.data.orderId },
    select: { id: true, organizationId: true, orderNumber: true, title: true }
  });
  if (!order || order.organizationId !== parsed.data.organizationId) {
    return { ok: false, error: 'not_found' };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const persisted = await persistUploadedDocument(prisma, {
    counterparty: { type: 'organization', id: parsed.data.organizationId },
    orderId: order.id,
    direction: 'incoming',
    docType: parsed.data.docType,
    uploadedById: session.sub,
    source: 'organization',
    file: { name: file.name, size: file.size, mimeType: file.type, buffer }
  });
  if (!persisted.ok) return persisted;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { name: true }
    });
    await notifyManagers(prisma, {
      orderId: order.id,
      type: 'document_uploaded_by_org',
      payload: { orgName: org?.name ?? 'организация', documentName: file.name, documentType: parsed.data.docType }
    });
  } catch (err) {
    console.warn('[uploadOrganizationDocument] notifyManagers failed', {
      documentId: persisted.documentId,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  revalidatePath('/organization/documents');
  return { ok: true, documentId: persisted.documentId };
}
