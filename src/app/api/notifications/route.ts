import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';

import type { SessionPayload } from '@/lib/auth/jwt';

async function buildScopeWhere(session: SessionPayload) {
  if (session.role === 'admin') return {};

  if (session.role === 'manager') {
    const memberships = await prisma.organizationUser.findMany({
      where: { userId: session.sub, isActive: true },
      select: { organizationId: true }
    });

    const organizationIds = memberships.map((membership) => membership.organizationId);

    if (organizationIds.length === 0) {
      return { id: { in: [] } };
    }

    return {
      OR: [
        { userId: session.sub },
        { organizationId: { in: organizationIds } }
      ]
    };
  }

  const scope: Array<Record<string, unknown>> = [{ userId: session.sub }];

  if (session.role === 'partner' && session.partnerId) scope.push({ partnerId: session.partnerId });
  if (session.role === 'organization' && session.organizationId) {
    scope.push({ organizationId: session.organizationId });
  }

  return { OR: scope };
}

export async function GET() {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const where = await buildScopeWhere(session);

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return NextResponse.json(notifications);
}

export async function PATCH(req: Request) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.value;

  const roleResult = requireRole(session, ['admin', 'manager', 'partner', 'organization']);
  if (!roleResult.ok) return roleResult.response;

  const { id, ids, isRead = true } = await req.json();
  const where = await buildScopeWhere(session);

  if (id) {
    const notification = await prisma.notification.updateMany({
      where: { AND: [{ id }, where] },
      data: { isRead }
    });
    return NextResponse.json(notification);
  }

  if (Array.isArray(ids) && ids.length > 0) {
    const notifications = await prisma.notification.updateMany({
      where: { AND: [{ id: { in: ids } }, where] },
      data: { isRead }
    });
    return NextResponse.json(notifications);
  }

  return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
}
