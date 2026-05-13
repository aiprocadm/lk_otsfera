import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';

function buildScopeWhere(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  if (session.role === 'admin') return {};

  const scope: Array<Record<string, unknown>> = [{ userId: session.sub }];

  if (session.role === 'partner' && session.partnerId) scope.push({ partnerId: session.partnerId });
  if ((session.role === 'organization' || session.role === 'manager') && session.organizationId) {
    scope.push({ organizationId: session.organizationId });
  }

  return { OR: scope };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: buildScopeWhere(session),
    orderBy: { createdAt: 'desc' },
    take: 50
  });

  return NextResponse.json(notifications);
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, ids, isRead = true } = await req.json();
  const where = buildScopeWhere(session);

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
