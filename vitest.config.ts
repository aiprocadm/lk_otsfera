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
    // Timeout: unit stays at vitest's tight 5s (fast pre-commit/pre-push feedback);
    // integration hits a live Postgres with many sequential round-trips and
    // fileParallelism:false, where 5s is marginal under DB/machine load (heavy
    // end-to-end cases run ~2-3.5s warm but can overshoot 5s cold on a loaded box).
    // 20s gives realistic headroom while still tripping a genuine hang/deadlock.
    // Non-unit (integration + the default all-mode `npm test`) gets the higher bound.
    testTimeout: mode === 'unit' ? 5000 : 20000,
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
        'src/**/{layout,loading,error,not-found,global-error,template}.tsx',
        // Worker process bootstrap: конструирование BullMQ Worker (нужен Redis),
        // SIGINT/SIGTERM-хендлеры, process.exit, main()-склейка. Вся бизнес-логика
        // вынесена в processors/* и lib/jobs/* (покрыты отдельно). Покрывается
        // worker integration/e2e, не unit. (План Task 5, variant B.)
        'src/worker/index.ts',
        // Чисто типовые модули (только `export type` / `interface`): компилируются
        // в пустой JS, исполняемого кода нет. v8 c `all:true` ошибочно рапортует их
        // как 0% (источник без execution-data), хотя ветвлений в них нет. Спека §3:
        // типовые модули вне denominator. (Перечисляем поимённо, не глобом, чтобы не
        // вычистить случайно файл с рантайм-логикой.)
        'src/lib/jobs/types.ts',
        'src/lib/services/oneCSync/adapter.ts',
        'src/lib/services/import/oneCAccountCard/types.ts',
        // Barrel-реэкспорты (только `export … from`, без исполняемых ветвлений):
        // конкретные модули импортируются напрямую, баррель в покрытом пути не
        // участвует → v8 c all:true рапортует 0%. Исполняемой логики нет (E1/трек E).
        'src/lib/services/customFields/index.ts',
        'src/lib/services/import/oneCAccountCard/index.ts',
        // Тот же barrel-паттерн для components/ui (Phase 3): только `export { X } from
        // './x'`, тесты импортируют конкретные компоненты напрямую, баррель нигде не
        // исполняется как модуль → 0% без исполняемой логики.
        'src/components/ui/index.ts'
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      // Per-glob 100%-гейт на логические слои (план Task 11). Применяется ТОЛЬКО к
      // полному прогону (`npm run test:coverage`, unit+integration) — там denominator
      // полный и цифра честная. В частичных режимах (`--mode=unit` / `--mode=integration`)
      // порог снят: ни один из них в одиночку не покрывает весь набор (integration-only
      // файлы 0% под unit, и наоборот), иначе `test:coverage:unit` падал бы ложно.
      // ВНИМАНИЕ: гейт ещё НЕ прогнан end-to-end против живого Postgres (на момент
      // правки PG-форвардинг WSL↔Windows лежал). Требуется один `npm run test:coverage`
      // с живой БД, чтобы подтвердить (а) проход и (б) что Vitest понимает extglob-ключ
      // `!(*.tsx)` (открытый вопрос spec §7). См. close-out coverage-phase1.
      ...(mode !== 'unit' && mode !== 'integration'
        ? {
            thresholds: {
              'src/lib/**/!(*.tsx)': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/server-actions/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/app/api/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/worker/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/middleware.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-2 (трек E): render-хуки + email-шаблоны под render-харнессом
              // (jsdom + @testing-library, per-file `// @vitest-environment jsdom` для
              // хуков; email — renderToStaticMarkup, node). SSR-гарды `typeof document`
              // внутри client-effect'ов — мёртвый код (эффекты только на клиенте) → v8-ignore.
              'src/hooks/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/lib/email/**/*.tsx': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 (UI-слои, первый срез): components/ui — презентационные примитивы
              // + LogoutButton/Dialog под Pattern P (renderToString) / Pattern I (jsdom +
              // @testing-library) харнессами. Барреля index.ts — в exclude выше (0% без
              // исполняемой логики, тот же паттерн что и lib-barrel'и).
              'src/components/ui/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1 Task 2: async server shells (dashboard/leader) под Pattern P /
              // async-server-component харнессом (await + renderToString).
              'src/components/dashboard/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/leader/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/commission/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/documents/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/access/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/auth/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/settings/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/orders/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/funnel/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/tasks/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/components/pwa-installer.tsx': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1: chat domain — order-thread inbox (interactive, jsdom) +
              // chat-composer/thread-view/unread-badge (Pattern P + I mixes).
              'src/components/chat/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1: enrollment domain — list/badge (Pattern P) + queue/request-form
              // (Pattern I: fetch/toast/router/window.prompt interactions).
              'src/components/enrollment/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1: import domain — 1С order/payment import forms + the payment
              // resolve queue table (Dialog primitive, async org/order search effects).
              'src/components/import/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1: training domain — certificate badge/list (Pattern P),
              // add-position-dialog/directions-admin/order-items-section (Pattern I,
              // Dialog primitive; two dialogs always mounted per parent, scoped via
              // dialog[open] + within()).
              'src/components/training/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1: organization cabinet — dashboard/order/finance/team widgets
              // (Pattern P), sidebar/filters/documents-search (Pattern I: jsdom + router
              // mocks), invite-form + app-shell (Dialog primitive / mocked sidebar shell),
              // and the two upload forms (Pattern I; file-input coverage via a jsdom
              // FileList-impl helper — see components.organization-document-upload-form
              // .test.tsx — since jsdom's own FormData construction, which React 19's
              // <form action> submits through, reads a file input's FileList impl
              // directly rather than the public `files` property).
              'src/components/organization/**': { lines: 100, branches: 100, functions: 100, statements: 100 }
            }
          }
        : {})
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
}));
