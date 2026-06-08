import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { hideInfectedForSession } from '@/lib/services/scan/visibility';

// This endpoint is consumed exclusively by the admin panel (DocumentsPanel).
// organization and partner roles are excluded: they must use channel-scoped service
// layer reads (organizationChannelWhere / partnerChannelWhere) so that cross-channel
// document metadata cannot leak via a direct authenticated GET.
export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const s = sessionResult.value;

  const roleResult = requireRole(s, ['admin', 'manager']);
  if (!roleResult.ok) return roleResult.response;

  const accessWhere =
    s.role === 'admin'
      ? {}
      : { order: { company: { organizations: { some: { organizationUsers: { some: { userId: s.sub, isActive: true } } } } } } };

  const docs = await prisma.document.findMany({
    where: { ...accessWhere, ...hideInfectedForSession(s) },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, mimeType: true, createdAt: true, orderId: true }
  });

  return NextResponse.json(docs);
}
