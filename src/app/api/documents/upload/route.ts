import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyDocumentCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';
import { canReadOrder, forbiddenResponse } from '@/lib/auth/policy';
import { documentBucket, supabaseAdmin } from '@/lib/storage/supabase';

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const MAX_FILE_SIZE_MB = Number(process.env.DOCUMENT_MAX_FILE_SIZE_MB ?? 10);
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const orderId = String(form.get('orderId') ?? '');
  const file = form.get('file');

  if (!orderId || !(file instanceof File)) {
    return NextResponse.json({ error: 'orderId and file are required' }, { status: 400 });
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: `File exceeds ${MAX_FILE_SIZE_MB}MB limit` }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!(await canReadOrder(s, order))) return forbiddenResponse('You do not have access to upload documents for this order');

  const organization = await prisma.organization.findFirst({ where: { companyId: order.companyId }, select: { id: true, partnerId: true } });
  if (!organization) {
    return NextResponse.json({ error: 'Organization context not found' }, { status: 400 });
  }

  const tenantPath = `partner/${organization.partnerId}/org/${organization.id}/order/${order.id}`;
  const internalPath = `${tenantPath}/${Date.now()}-${sanitizeFilename(file.name)}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadError } = await supabaseAdmin.storage
    .from(documentBucket)
    .upload(internalPath, Buffer.from(arrayBuffer), { contentType: file.type, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const doc = await prisma.document.create({
    data: { orderId, name: file.name, path: internalPath, mimeType: file.type, uploadedById: s.sub }
  });

  await prisma.auditLog.create({
    data: {
      action: 'document_upload',
      entity: 'document',
      entityId: doc.id,
      userId: s.sub,
      meta: { orderId, path: internalPath, mimeType: file.type, size: file.size }
    }
  });

  const organizationId = await getPrimaryOrganizationId(s);

  await notifyDocumentCreated({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Новый документ',
    body: `Загружен документ ${file.name}`,
    meta: { orderId, documentId: doc.id }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Новый документ', body: `Загружен документ ${file.name}`, type: 'document_created' });

  return NextResponse.json({ id: doc.id, name: doc.name, mimeType: doc.mimeType, createdAt: doc.createdAt });
}
