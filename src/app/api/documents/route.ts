import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const where =
    s.role === 'admin'
      ? {}
      : s.role === 'organization' && s.organizationId
        ? { order: { company: { organizations: { some: { id: s.organizationId } } } } }
        : s.role === 'partner' && s.partnerId
          ? { order: { company: { organizations: { some: { partnerId: s.partnerId } } } } }
          : s.role === 'manager'
            ? { order: { company: { organizations: { some: { organizationUsers: { some: { userId: s.sub, isActive: true } } } } } } }
            : null;

  if (where === null) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const docs = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, mimeType: true, createdAt: true, orderId: true }
  });

  return NextResponse.json(docs);
}
