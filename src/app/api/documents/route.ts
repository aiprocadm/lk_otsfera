import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';

export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const roleResult = requireRole(s, ['admin', 'organization', 'partner', 'manager']);
  if (!roleResult.ok) return roleResult.response;

  const where =
    s.role === 'admin'
      ? {}
      : s.role === 'organization' && s.organizationId
        ? { order: { company: { organizations: { some: { id: s.organizationId } } } } }
        : s.role === 'partner' && s.partnerId
          ? { order: { company: { organizations: { some: { partnerId: s.partnerId } } } } }
          : s.role === 'manager'
            ? { order: { company: { organizations: { some: { organizationUsers: { some: { userId: s.sub, isActive: true } } } } } } }
            : { order: { company: { organizations: { some: { organizationUsers: { some: { userId: s.sub, isActive: true } } } } } } };

  const docs = await prisma.document.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, mimeType: true, createdAt: true, orderId: true }
  });

  return NextResponse.json(docs);
}
