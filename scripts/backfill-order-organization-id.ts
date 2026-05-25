/**
 * CLI: backfill Order.organizationId for legacy rows.
 *
 * Strategy A — query 1C adapter for current orders, match by externalId,
 * resolve to Organization.externalId → Organization.id.
 *
 * Strategy B (fallback for orders without externalId) — if the order's
 * Company has exactly one Organization, assign that org. Skip otherwise.
 *
 * Idempotent: every UPDATE filters WHERE organizationId IS NULL.
 *
 *   npx tsx scripts/backfill-order-organization-id.ts
 */

import { prisma } from '../src/lib/db/prisma';
import { backfillOrderOrganizationId } from '../src/lib/services/organization/backfillOrderOrg';

async function main() {
  console.log('[backfill-order-org] starting');
  const summary = await backfillOrderOrganizationId();
  console.log('[backfill-order-org] done', summary);
  if (summary.left_null > 0) {
    console.warn(`[backfill-order-org] WARN: ${summary.left_null} orders still without organizationId`);
  }
}

main()
  .catch((err) => {
    console.error('[backfill-order-org] error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
