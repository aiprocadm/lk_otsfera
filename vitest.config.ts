import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

/**
 * Test mode is selected via `vitest --mode=<unit|integration>` from the CLI.
 * Without `--mode`, all tests run (the historical default; preserves
 * `npm test` and editor "Run all tests" behaviour).
 *
 * Mode partitioning is **self-detecting**: a test file is "integration" iff
 * its source contains `new PrismaClient(` (i.e. it spins up a real client
 * and needs live Postgres). Everything else is "unit". This keeps the
 * config maintenance-free as new tests are added.
 *
 * Why not a hardcoded list: 33 entries that drift out of sync with reality
 * silently. A grep-style detector stays correct by construction.
 */
const TEST_ROOTS = [path.resolve(__dirname, 'src/__tests__'), path.resolve(__dirname, 'mock-1c')];
const INTEGRATION_MARKER = 'new PrismaClient(';

/**
 * Returns POSIX-style paths relative to repo root so Vitest's filter
 * (positional CLI args, normalized to forward slashes) can substring-match
 * the include list on Windows.
 */
function listTestFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const name of entries) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...listTestFiles(full));
      continue;
    }
    if (/\.test\.(ts|tsx)$/.test(name)) {
      const rel = path.relative(__dirname, full).split(path.sep).join('/');
      out.push(rel);
    }
  }
  return out;
}

function isIntegrationFile(relPath: string): boolean {
  try {
    const abs = path.resolve(__dirname, relPath);
    return readFileSync(abs, 'utf8').includes(INTEGRATION_MARKER);
  } catch {
    return false;
  }
}

const allTestFiles = TEST_ROOTS.flatMap((root) => {
  try { return listTestFiles(root); } catch { return []; } // mock-1c may not exist yet
});
const integrationFiles = allTestFiles.filter(isIntegrationFile);
const unitFiles = allTestFiles.filter((f) => !integrationFiles.includes(f));

function includeFor(mode: string | undefined): string[] {
  if (mode === 'unit') return unitFiles;
  if (mode === 'integration') return integrationFiles;
  // Default: everything (matches historical `npm test` behaviour)
  return allTestFiles;
}

export default defineConfig(({ mode }) => ({
  test: {
    environment: 'node',
    globals: true,
    include: includeFor(mode),
    // Multiple test files share a single live Postgres and use overlapping
    // 1C fixture externalIds; running them in parallel forks causes
    // cross-file cleanup races. Keep file execution sequential.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // `all: true` reports source files that NO test imports as 0%, instead
      // of silently omitting them. Essential for a true baseline — otherwise
      // the denominator is only "files some test happened to touch".
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.{ts,tsx}',
        'src/e2e/**', // Playwright specs — not executed by Vitest
        'src/**/*.d.ts',
        // Беслогичные фреймворк-шеллы Next (спека §3): чистая навигационная
        // обвязка без ветвлений — покрывается e2e, не unit.
        'src/**/{layout,loading,error,not-found,global-error,template}.tsx'
      ],
      reporter: ['text-summary', 'json-summary', 'html']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
}));
