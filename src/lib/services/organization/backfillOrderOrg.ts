import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '@/lib/db/prisma';
import { getOneCAdapter } from '@/lib/services/oneCSync';
import { writeSyncLog } from '@/lib/services/oneCSync/log';

export type BackfillSummary = {
  matched_via_1c: number;
  matched_via_company: number;
  left_null: number;
};

export async function backfillOrderOrganizationId(
  db: PrismaClient = defaultPrisma
): Promise<BackfillSummary> {
  const startedAt = Date.now();
  const summary: BackfillSummary = {
    matched_via_1c: 0,
    matched_via_company: 0,
    left_null: 0
  };

  // Strategy A — through externalId via 1C adapter
  const withExt = await db.order.findMany({
    where: { organizationId: null, externalId: { not: null } },
    select: { id: true, externalId: true }
  });

  if (withExt.length > 0) {
    const adapter = getOneCAdapter();
    const dtos = await adapter.pullOrders({});
    const orgExtByOrderExt = new Map(dtos.map((d) => [d.externalId, d.organizationExternalId]));

    // Resolve all needed orgExt → orgId in one query
    const orgExtIds = Array.from(new Set(withExt.map((o) => orgExtByOrderExt.get(o.externalId!)).filter((v): v is string => Boolean(v))));
    const orgs = orgExtIds.length
      ? await db.organization.findMany({
          where: { externalId: { in: orgExtIds } },
          select: { id: true, externalId: true }
        })
      : [];
    const orgIdByExt = new Map(orgs.map((o) => [o.externalId!, o.id]));

    for (const order of withExt) {
      const orgExt = orgExtByOrderExt.get(order.externalId!);
      const orgId = orgExt ? orgIdByExt.get(orgExt) : undefined;
      if (orgId) {
        await db.order.update({
          where: { id: order.id, organizationId: null },
          data: { organizationId: orgId }
        }).catch(() => undefined); // ignore if concurrent write set organizationId
        summary.matched_via_1c += 1;
      }
    }
  }

  // Strategy B — Company heuristic for orders without externalId
  const withoutExt = await db.order.findMany({
    where: { organizationId: null, externalId: null },
    select: { id: true, companyId: true }
  });

  if (withoutExt.length > 0) {
    const companyIds = Array.from(new Set(withoutExt.map((o) => o.companyId)));
    const orgsByCompany = await db.organization.findMany({
      where: { companyId: { in: companyIds } },
      select: { id: true, companyId: true }
    });
    const orgsCountByCompany = new Map<string, { count: number; orgId: string }>();
    for (const o of orgsByCompany) {
      if (!o.companyId) continue;
      const prev = orgsCountByCompany.get(o.companyId);
      orgsCountByCompany.set(o.companyId, {
        count: (prev?.count ?? 0) + 1,
        orgId: o.id
      });
    }

    for (const order of withoutExt) {
      const entry = orgsCountByCompany.get(order.companyId);
      if (entry && entry.count === 1) {
        await db.order.update({
          where: { id: order.id, organizationId: null },
          data: { organizationId: entry.orgId }
        }).catch(() => undefined);
        summary.matched_via_company += 1;
      }
    }
  }

  // Count still-null orders
  summary.left_null = await db.order.count({ where: { organizationId: null } });

  await writeSyncLog(
    {
      entity: 'order',
      direction: 'inbound',
      operation: 'update',
      status: summary.left_null > 0 ? 'warn' : 'success',
      payload: { backfill_order_org: true, ...summary },
      durationMs: Date.now() - startedAt
    },
    db
  );

  return summary;
}
