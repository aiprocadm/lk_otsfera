/**
 * Pre-deploy dedupe for migration 20260614000000_commission_statement_partial_unique
 * (C-01): that migration adds a PARTIAL UNIQUE index on
 * (partnerId, periodFrom, periodTo) WHERE supersededBy IS NULL. If prod already
 * holds more than one LIVE (non-superseded) statement for any such group, the
 * `CREATE UNIQUE INDEX` will fail during `prisma migrate deploy`.
 *
 * This script finds those groups and, per group, KEEPS the latest by calculatedAt
 * and marks the rest superseded (supersededBy = kept id) — the same discriminator
 * the index and the app use. Run it against PROD BEFORE deploying the migration.
 *
 * DRY-RUN by default (read-only, reports what it would do). Pass --apply to mutate.
 * Exit 0 = clean or applied; exit 1 = duplicates found in dry-run / error.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/dedupe-commission-statements.ts          # report
 *   DATABASE_URL=<prod> npx tsx scripts/dedupe-commission-statements.ts --apply  # fix
 */
import { prisma } from '../src/lib/db/prisma';

type GroupRow = { partnerId: string; periodFrom: Date; periodTo: Date; n: number };

const APPLY = process.argv.includes('--apply');

async function findLiveDuplicateGroups(): Promise<GroupRow[]> {
  return prisma.$queryRaw<GroupRow[]>`
    SELECT "partnerId", "periodFrom", "periodTo", COUNT(*)::int AS n
    FROM "CommissionStatement"
    WHERE "supersededBy" IS NULL
    GROUP BY "partnerId", "periodFrom", "periodTo"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC`;
}

async function main(): Promise<void> {
  const groups = await findLiveDuplicateGroups();

  if (groups.length === 0) {
    console.log(
      '[commission-dedupe] OK — no duplicate live statements; safe to apply the partial-unique index.'
    );
    return;
  }

  console.log(
    `[commission-dedupe] ${groups.length} group(s) with >1 live statement${APPLY ? ' — applying fix:' : ' (DRY-RUN, pass --apply to fix):'}`
  );

  let supersededTotal = 0;
  for (const g of groups) {
    // Order by calculatedAt DESC, then createdAt DESC as a stable tiebreaker.
    const rows = await prisma.commissionStatement.findMany({
      where: {
        partnerId: g.partnerId,
        periodFrom: g.periodFrom,
        periodTo: g.periodTo,
        supersededBy: null,
      },
      orderBy: [{ calculatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, calculatedAt: true, status: true },
    });
    const [keep, ...losers] = rows;
    // The group came from a HAVING COUNT(*) > 1 aggregate over the same live
    // rows, so `keep` is always present. Guard only against a concurrent change
    // between the two queries: fail loudly (as the previous TypeError did)
    // rather than silently skipping a group before a migration.
    if (!keep) {
      throw new Error(
        `[commission-dedupe] no live statements left for partner=${g.partnerId} ` +
          `period=${g.periodFrom.toISOString()}..${g.periodTo.toISOString()} — concurrent change?`
      );
    }
    console.log(
      `  partner=${g.partnerId} period=${g.periodFrom.toISOString()}..${g.periodTo.toISOString()}: ` +
        `keep ${keep.id} (calculatedAt=${keep.calculatedAt.toISOString()}), supersede ${losers.map((l) => l.id).join(', ')}`
    );

    if (APPLY) {
      await prisma.commissionStatement.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { supersededBy: keep.id },
      });
    }
    supersededTotal += losers.length;
  }

  if (APPLY) {
    console.log(
      `\n[commission-dedupe] DONE — superseded ${supersededTotal} row(s). Safe to apply the migration now.`
    );
  } else {
    console.error(
      `\n[commission-dedupe] FAIL: ${supersededTotal} row(s) would be superseded. Re-run with --apply, then migrate.`
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[commission-dedupe] error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
