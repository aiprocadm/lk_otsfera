/**
 * Recreate the LOCAL dev/test Postgres database with the ICU locale provider.
 *
 * Why this exists
 * ---------------
 * Postgres folds case (lower()/upper() and the ILIKE Prisma emits for
 * `mode:'insensitive'`) according to the COLLATION of the operand, not a global
 * setting. A database created under libc locale `C`/`POSIX` folds case only for
 * ASCII — so case-insensitive search over Cyrillic silently returns 0 rows.
 *
 * On Windows the cluster's `template1` is often locale `C`, so a DB auto-created
 * by `prisma migrate deploy` inherits `datcollate=C / datctype=C` and breaks the
 * Cyrillic-search integration tests (org orders/students, partner portfolio).
 * Recreating with the ICU provider gives full Unicode case folding and the suite
 * passes 390/390 — matching the canonical (Linux/WSL) environment.
 *
 *   npm run db:recreate-local        # drop + recreate `cabinet` with ICU, verify folding
 *   # then:
 *   npm run prisma:migrate:deploy
 *   npm run prisma:seed
 *
 * Cross-platform (tsx, no psql/bash dependency). DESTRUCTIVE: drops the target DB.
 * Guarded to localhost only so it can never touch a managed/remote database.
 */
import { PrismaClient } from '@prisma/client';

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/cabinet';

function parse(url: string) {
  const u = new URL(url);
  const dbName = u.pathname.replace(/^\//, '');
  return { u, dbName };
}

const { u, dbName } = parse(DB_URL);

// Safety: refuse to run against anything but a loopback host. Dropping a remote
// database from a dev helper would be catastrophic.
const host = u.hostname.toLowerCase();
if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
  console.error(
    `[recreate-local-db] refusing: DATABASE_URL host is "${host}", not localhost. ` +
      `This script only recreates a LOCAL database.`
  );
  process.exit(1);
}

// Maintenance connection: same server, `postgres` database (can't drop the DB
// you're connected to).
const adminUrl = DB_URL.replace(new RegExp(`/${dbName}(\\?|$)`), '/postgres$1');

async function runSql<T = unknown>(url: string, sql: string): Promise<T[]> {
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    return await p.$queryRawUnsafe<T[]>(sql);
  } finally {
    await p.$disconnect();
  }
}

async function main() {
  console.log(`[recreate-local-db] target: ${dbName} @ ${host} (ICU locale provider)`);

  await runSql(
    adminUrl,
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid <> pg_backend_pid()`
  );
  await runSql(adminUrl, `DROP DATABASE IF EXISTS "${dbName}"`);
  await runSql(
    adminUrl,
    `CREATE DATABASE "${dbName}" TEMPLATE template0 ENCODING 'UTF8' ` +
      `LOCALE_PROVIDER icu ICU_LOCALE 'und' LC_COLLATE 'C' LC_CTYPE 'C'`
  );

  const [fold] = await runSql<{ cyr_ilike: boolean; cyr_lower: boolean }>(
    DB_URL,
    `SELECT ('Иван' ILIKE 'иван') AS cyr_ilike, (lower('ИВАН') = 'иван') AS cyr_lower`
  );
  if (!fold?.cyr_ilike) {
    console.error('[recreate-local-db] FAILED: Cyrillic ILIKE still does not fold case', fold);
    process.exit(1);
  }

  console.log(
    `[recreate-local-db] done — Cyrillic case-insensitive search works (cyr_ilike=${fold.cyr_ilike}).`
  );
  console.log(
    '[recreate-local-db] next: `npm run prisma:migrate:deploy` then `npm run prisma:seed`.'
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[recreate-local-db] error:', e?.message ?? e);
    process.exit(1);
  });
