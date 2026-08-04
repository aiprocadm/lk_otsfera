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
 *
 * ATOMICITY (fix, phase «остатки аудита»): the whole sweep — the duplicate-group
 * aggregate, the per-group reads and every `supersede` write — runs inside ONE
 * Serializable transaction. Before that it was three unsynchronised steps, so a
 * concurrent write (a commission recalculation for the same period) could make
 * the script die mid-loop with some groups already superseded and others not —
 * exactly the half-applied state you do not want minutes before a migration.
 * Now it is all-or-nothing: on any error the database is untouched.
 *
 * Run it in a maintenance window: Serializable holds locks for the duration.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';

type GroupRow = { partnerId: string; periodFrom: Date; periodTo: Date; n: number };

const APPLY = process.argv.includes('--apply');

/** Ceiling for the whole sweep. Prod duplicate sets are small (tens of rows). */
const TX_TIMEOUT_MS = 120_000;
const TX_MAX_WAIT_MS = 15_000;

async function findLiveDuplicateGroups(tx: Prisma.TransactionClient): Promise<GroupRow[]> {
  return tx.$queryRaw<GroupRow[]>`
    SELECT "partnerId", "periodFrom", "periodTo", COUNT(*)::int AS n
    FROM "CommissionStatement"
    WHERE "supersededBy" IS NULL
    GROUP BY "partnerId", "periodFrom", "periodTo"
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC`;
}

/** Returns how many rows were (or would be) superseded. */
async function sweep(tx: Prisma.TransactionClient): Promise<number> {
  const groups = await findLiveDuplicateGroups(tx);

  if (groups.length === 0) {
    console.log(
      '[commission-dedupe] OK — no duplicate live statements; safe to apply the partial-unique index.'
    );
    return 0;
  }

  console.log(
    `[commission-dedupe] ${groups.length} group(s) with >1 live statement${APPLY ? ' — applying fix:' : ' (DRY-RUN, pass --apply to fix):'}`
  );

  let supersededTotal = 0;
  for (const g of groups) {
    // Order by calculatedAt DESC, then createdAt DESC as a stable tiebreaker.
    const rows = await tx.commissionStatement.findMany({
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
    // Inside the Serializable transaction the aggregate and this read see the
    // same snapshot, so `keep` is structurally present. Defensive only: fail
    // loudly (and roll the whole sweep back) instead of skipping a group.
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
      await tx.commissionStatement.updateMany({
        where: { id: { in: losers.map((l) => l.id) } },
        data: { supersededBy: keep.id },
      });
    }
    supersededTotal += losers.length;
  }

  return supersededTotal;
}

async function main(): Promise<void> {
  // Один интерактивный транзакционный блок на весь проход: и dry-run (тогда он
  // read-only и даёт согласованный отчёт), и --apply (тогда — всё или ничего).
  const supersededTotal = await prisma.$transaction(sweep, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: TX_TIMEOUT_MS,
    maxWait: TX_MAX_WAIT_MS,
  });

  if (supersededTotal === 0) return;

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
