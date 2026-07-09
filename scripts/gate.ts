/**
 * Local integration gate (CLAUDE.md §6 "L2.5"; spec 2026-05-31-test-safety-net).
 *
 * Spins up the Dockerized Postgres + Redis from docker-compose.yml, applies
 * migrations + seed against a HOST-FACING DATABASE_URL (localhost, not the
 * compose-internal `db` host), then runs the integration tier. Cross-platform
 * (tsx, not bash) so it behaves the same on Windows/PowerShell and sh.
 * Redis обязателен: интеграционный слой ходит по enqueue-путям (PDF/XLSX
 * комиссии, скан) — при REDIS_URL в .env и мёртвом Redis они виснут до
 * test-таймаута (ioredis с maxRetriesPerRequest:null ретраит бесконечно).
 *
 *   npm run gate         # up → migrate → seed → integration tests (leaves DB up)
 *   npm run gate:down    # stop the db/redis containers
 *
 * GATE_SKIP_DOCKER=1 skips the `docker compose up` + readiness wait: for
 * environments where Postgres is provided externally (GitHub Actions service
 * container). Pair with GATE_DATABASE_URL when the DSN differs from the
 * localhost:5432 default. CI runs THIS script (not a YAML copy of its steps)
 * so the server gate can't drift from the local L2.5 gate.
 */
import { spawn, spawnSync } from 'node:child_process';

// The compose .env points DATABASE_URL at host `db` (resolvable only inside the
// compose network). A host-side runner must use localhost. dotenv (loaded by the
// Prisma CLI) never overrides an already-set env var, so this wins over .env.
const DB_URL =
  process.env.GATE_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/cabinet';
const childEnv = { ...process.env, DATABASE_URL: DB_URL, DIRECT_URL: DB_URL };
const useShell = process.platform === 'win32'; // resolve npm.cmd / docker.exe

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: childEnv, shell: useShell });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.join(' ')}\` exited with ${code}`))
    );
  });
}

function pgReady(): boolean {
  const r = spawnSync(
    'docker',
    ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', 'postgres', '-d', 'cabinet'],
    { stdio: 'ignore', env: childEnv, shell: useShell }
  );
  return r.status === 0;
}

async function waitForPostgres(maxAttempts = 30): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    if (pgReady()) {
      console.log(`[gate] Postgres healthy (attempt ${i}).`);
      return;
    }
    console.log(`[gate] waiting for Postgres… (${i}/${maxAttempts})`);
    await sleep(2000);
  }
  throw new Error('[gate] Postgres did not become healthy within ~60s.');
}

async function main(): Promise<void> {
  if (process.argv.includes('--down')) {
    await run('docker', ['compose', 'stop', 'db', 'redis']);
    console.log('[gate] containers stopped.');
    return;
  }

  if (process.env.GATE_SKIP_DOCKER === '1') {
    console.log('[gate] GATE_SKIP_DOCKER=1 — assuming an externally provided Postgres.');
  } else {
    console.log('[gate] starting Dockerized Postgres + Redis…');
    await run('docker', ['compose', 'up', '-d', 'db', 'redis']);
    await waitForPostgres();
  }

  console.log('[gate] applying migrations…');
  await run('npm', ['run', 'prisma:migrate:deploy']);

  console.log('[gate] seeding…');
  await run('npm', ['run', 'prisma:seed']);

  console.log('[gate] running integration tests…');
  await run('npm', ['run', 'test:integration']);

  console.log('[gate] ✓ integration suite green.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
