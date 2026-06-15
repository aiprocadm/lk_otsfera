import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { managedOrgIds, managerOrderScopeFilter } from '@/lib/auth/managerPolicy';

import type { SessionPayload } from '@/lib/auth/jwt';

const patchSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  ids: z.array(z.string().min(1).max(64)).max(100).optional(),
  isRead: z.boolean().optional()
}).refine((d) => d.id || (d.ids && d.ids.length > 0), {
  message: 'id or ids required'
});

async function buildScopeWhere(session: SessionPayload) {
  if (session.role === 'admin') return {};

  if (session.role === 'manager') {
    // Manager visibility follows managerOrderScopeFilter (per-order ownership +
    // per-org scope from session.managedOrgIds + historical commenter access).
    // Notification has no direct Order FK, so we hydrate the in-scope order IDs
    // and match them via meta.orderId for order-bound fan-outs that did not
    // also stamp organizationId (e.g. per-order ownership in a foreign org).
    const orgIds = managedOrgIds(session);
    const visibleOrders = await prisma.order.findMany({
      where: managerOrderScopeFilter(session),
      select: { id: true }
    });
    const orderIds = visibleOrders.map((order) => order.id);

    const branches: Array<Record<string, unknown>> = [{ userId: session.sub }];
    if (orgIds.length > 0) branches.push({ organizationId: { in: orgIds } });
    for (const orderId of orderIds) {
      branches.push({ meta: { path: ['orderId'], equals: orderId } });
    }

    return { OR: branches };
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

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
  }

  const { id, ids, isRead = true } = parsed.data;
  const where = await buildScopeWhere(session);

  if (id) {
    const notification = await prisma.notification.updateMany({
      where: { AND: [{ id }, where] },
      data: { isRead }
    });
    return NextResponse.json(notification);
  }

  if (ids && ids.length > 0) {
    const notifications = await prisma.notification.updateMany({
      where: { AND: [{ id: { in: ids } }, where] },
      data: { isRead }
    });
    return NextResponse.json(notifications);
  } /* v8 ignore next -- false branch of ids check unreachable after schema refine */
  /* v8 ignore next -- defensive fallback; schema refine guarantees id or non-empty ids after safeParse success */
  return NextResponse.json({ error: 'id or ids required' }, { status: 400 });
}
