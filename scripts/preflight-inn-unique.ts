/**
 * Preflight for migration 20260609000000_org_level_payments_and_inn_keys:
 * detect duplicate non-null INN values BEFORE its UNIQUE indexes are created
 * (`Partner_inn_key`, `Organization_inn_key`).
 *
 * PostgreSQL UNIQUE indexes treat NULLs as distinct, so only NON-NULL duplicate
 * INNs would make `CREATE UNIQUE INDEX` fail during `prisma migrate deploy`.
 * `Partner.inn` is added by that same migration (NULL on every existing row → no
 * risk), but `Organization.inn` predates it and may already hold duplicates in
 * prod. Run this against the PROD database before deploying; if it reports
 * duplicates, dedupe them first, then migrate.
 *
 * Read-only. Exit 0 = clean (safe to migrate). Exit 1 = duplicates found / error.
 *
 *   DATABASE_URL=<prod> npx tsx scripts/preflight-inn-unique.ts
 *   DATABASE_URL=<prod> npm run preflight:inn
 *
 * Uses raw SQL on purpose: run pre-migration, `Partner.inn` does not yet exist,
 * so a typed-model query (generated from the new schema) would throw. Each table
 * is guarded by an information_schema column-existence check first.
 */
import { prisma } from '../src/lib/db/prisma';

const TABLES = ['Partner', 'Organization'] as const;
type InnTable = (typeof TABLES)[number];
type DuplicateRow = { inn: string; n: number };

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    ) AS present`;
  return rows[0]?.present === true;
}

// Table identifiers can't be bound parameters, so each branch uses a literal
// tagged template (no string interpolation of untrusted input).
async function findDuplicates(table: InnTable): Promise<DuplicateRow[]> {
  return table === 'Partner'
    ? prisma.$queryRaw<DuplicateRow[]>`
        SELECT "inn" AS inn, COUNT(*)::int AS n FROM "Partner"
        WHERE "inn" IS NOT NULL GROUP BY "inn" HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, "inn"`
    : prisma.$queryRaw<DuplicateRow[]>`
        SELECT "inn" AS inn, COUNT(*)::int AS n FROM "Organization"
        WHERE "inn" IS NOT NULL GROUP BY "inn" HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, "inn"`;
}

async function main(): Promise<void> {
  let dupGroups = 0;
  for (const table of TABLES) {
    if (!(await columnExists(table, 'inn'))) {
      console.log(`[inn-preflight] ${table}.inn absent (pre-migration) — no duplicates possible, skipping.`);
      continue;
    }
    const dups = await findDuplicates(table);
    if (dups.length === 0) {
      console.log(`[inn-preflight] ${table}.inn: OK — no non-null duplicates.`);
      continue;
    }
    dupGroups += dups.length;
    console.error(`[inn-preflight] ${table}.inn: FAIL — ${dups.length} duplicate value(s); UNIQUE index would error:`);
    for (const d of dups) console.error(`    inn=${d.inn} ×${d.n}`);
  }

  if (dupGroups > 0) {
    console.error(`\n[inn-preflight] FAIL: ${dupGroups} duplicate INN group(s). Dedupe before \`prisma migrate deploy\`.`);
    process.exitCode = 1;
  } else {
    console.log('\n[inn-preflight] OK: safe to apply the inn UNIQUE indexes.');
  }
}

main()
  .catch((err) => {
    console.error('[inn-preflight] error', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
