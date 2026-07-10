import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
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

async function buildScopeWhere(
  session: SessionPayload,
  opts: { candidateIds?: string[] } = {}
) {
  if (session.role === 'admin') return {};

  if (session.role === 'manager') {
    // Manager visibility follows managerOrderScopeFilter (per-order ownership +
    // per-org scope from session.managedOrgIds + historical commenter access).
    // Notification has no direct Order FK, so we hydrate the in-scope order IDs
    // and match them via meta.orderId for order-bound fan-outs that did not
    // also stamp organizationId (e.g. per-order ownership in a foreign org).
    //
    // R1.2: раньше на КАЖДЫЙ видимый заказ строилась отдельная OR-ветка с
    // JSONB-путём — при тысячах заказов SQL-план взрывался. Теперь кандидаты
    // собираются ОДНИМ raw-запросом `meta->>'orderId' IN (…)` и входят в scope
    // веткой `id IN (…)`. Контракт сохранён: GET отдаёт top-50 по createdAt —
    // top-50 кандидатов по createdAt покрывают любой возможный вклад meta-ветки
    // в этот срез; PATCH ограничен своими candidateIds (≤100 по схеме), поэтому
    // кандидаты фильтруются ими и остаются bounded.
    const orgIds = managedOrgIds(session);
    const visibleOrders = await prisma.order.findMany({
      where: managerOrderScopeFilter(session),
      select: { id: true }
    });
    const orderIds = visibleOrders.map((order) => order.id);

    const branches: Array<Record<string, unknown>> = [{ userId: session.sub }];
    if (orgIds.length > 0) branches.push({ organizationId: { in: orgIds } });

    if (orderIds.length > 0) {
      const rows = await prisma.$queryRaw<Array<{ id: string }>>(
        opts.candidateIds
          ? Prisma.sql`SELECT id FROM "Notification"
              WHERE id IN (${Prisma.join(opts.candidateIds)})
                AND (meta->>'orderId') IN (${Prisma.join(orderIds)})`
          : Prisma.sql`SELECT id FROM "Notification"
              WHERE (meta->>'orderId') IN (${Prisma.join(orderIds)})
              ORDER BY "createdAt" DESC
              LIMIT 50`
      );
      if (rows.length > 0) branches.push({ id: { in: rows.map((r) => r.id) } });
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
  const where = await buildScopeWhere(session, { candidateIds: id ? [id] : ids! });

  if (id) {
    const notification = await prisma.notification.updateMany({
      where: { AND: [{ id }, where] },
      data: { isRead }
    });
    return NextResponse.json(notification);
  }

  // Schema refine guarantees ids is non-empty when id is absent; ids! safe to assert non-null here
  const notifications = await prisma.notification.updateMany({
    where: { AND: [{ id: { in: ids! } }, where] },
    data: { isRead }
  });
  return NextResponse.json(notifications);
}
