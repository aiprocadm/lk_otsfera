import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { notifyDocumentCreated, triggerNotificationEmail } from '@/lib/notifications';
import { getPrimaryOrganizationId } from '@/lib/auth/organization';

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await prisma.organizationUser.findFirst({ where: { userId: s.sub, isActive: true } });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { orderId, name, path, mimeType } = await req.json();
  const doc = await prisma.document.create({ data: { orderId, name, path, mimeType, uploadedById: s.sub } });
  const organizationId = await getPrimaryOrganizationId(s);

  await notifyDocumentCreated({
    userId: s.sub,
    organizationId,
    partnerId: s.partnerId,
    title: 'Новый документ',
    body: `Загружен документ ${name}`,
    meta: { orderId, documentId: doc.id }
  });

  await triggerNotificationEmail({ userId: s.sub, title: 'Новый документ', body: `Загружен документ ${name}`, type: 'document_created' });

  return NextResponse.json(doc);
}
