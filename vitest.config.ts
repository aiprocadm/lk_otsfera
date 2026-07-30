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
    setupFiles: ['src/__tests__/helpers/vitest.setup.ts'],
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
        'src/lib/inbound/email/adapter.ts',
        // Barrel-реэкспорты (только `export … from`, без исполняемых ветвлений):
        // конкретные модули импортируются напрямую, баррель в покрытом пути не
        // участвует → v8 c all:true рапортует 0%. Исполняемой логики нет (E1/трек E).
        'src/lib/services/customFields/index.ts',
        'src/lib/services/import/oneCAccountCard/index.ts',
        // Тот же barrel-паттерн для components/ui (Phase 3): только `export { X } from
        // './x'`, тесты импортируют конкретные компоненты напрямую, баррель нигде не
        // исполняется как модуль → 0% без исполняемой логики.
        'src/components/ui/index.ts',
        // Barrel домена logging (PR-2): только реэкспорты logger/scrub.
        'src/lib/logging/index.ts'
      ],
      reporter: ['text-summary', 'json-summary', 'html'],
      // Per-glob 100%-гейт на логические слои (план Task 11). Применяется ТОЛЬКО к
      // полному прогону (`npm run test:coverage`, unit+integration) — там denominator
      // полный и цифра честная. В частичных режимах (`--mode=unit` / `--mode=integration`)
      // порог снят: ни один из них в одиночку не покрывает весь набор (integration-only
      // файлы 0% под unit, и наоборот), иначе `test:coverage:unit` падал бы ложно.
      // ПРОГНАН end-to-end 30.07.2026 против живого Postgres (первый раз за всё
      // время). Extglob-ключ `!(*.tsx)` Vitest понимает — открытый вопрос spec §7
      // закрыт. Результат: гейт КРАСНЫЙ, 108 файлов ниже 100% (факт по репозиторию:
      // строки 99.31%, ветки 98.48%, функции 98.43%).
      //
      // ФАЗА Ф0 программы погашения долга (spec 2026-07-30-coverage-debt-design.md,
      // решение заказчика 30.07.2026, вариант C): пороги опущены до ФАКТИЧЕСКИ
      // достигнутого уровня. Смысл — не «сдаться», а сделать цифру честной: с этого
      // момента гейт зелёный и падает на ЛЮБОМ ухудшении, то есть долг перестаёт
      // расти, пока фазы Ф1–Ф4 его закрывают. Каждая фаза поднимает свои цифры;
      // Ф5 возвращает все обратно к 100%. Цифры ниже — НЕ цель, а нижняя планка:
      // повышать можно, понижать — только с решением заказчика.
      //
      // Почему на 0.01 ниже измеренного: отчёт печатает проценты округлёнными до
      // сотых, а сравнение идёт по точному значению — порог «ровно как в отчёте»
      // может оказаться выше факта и дать ложную красноту. 0.01% — это доли одной
      // ветки из 18 тысяч; на ловле реальных регрессов не сказывается.
      ...(mode !== 'unit' && mode !== 'integration'
        ? {
            thresholds: {
              'src/lib/**/!(*.tsx)': { lines: 99.61, branches: 99.03, functions: 99.73, statements: 99.61 },
              // Ф1: закрыт `server-actions/manager/create-lead.ts` (был 0%) — набор вышел
              // на 100% по строкам/операторам/функциям, остались только ветки.
              'src/server-actions/**': { lines: 100, branches: 98.14, functions: 100, statements: 100 },
              'src/app/api/**': { lines: 99.92, branches: 99.38, functions: 100, statements: 99.92 },
              'src/worker/**': { lines: 99.44, branches: 97.82, functions: 97.86, statements: 99.44 },
              'src/middleware.ts': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-2 (трек E): render-хуки + email-шаблоны под render-харнессом
              // (jsdom + @testing-library, per-file `// @vitest-environment jsdom` для
              // хуков; email — renderToStaticMarkup, node). SSR-гарды `typeof document`
              // внутри client-effect'ов — мёртвый код (эффекты только на клиенте) → v8-ignore.
              'src/hooks/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
              'src/lib/email/**/*.tsx': { lines: 100, branches: 100, functions: 100, statements: 100 },
              // PHASE-3 W1 (UI-компоненты) — весь `src/components/**` под порогом 100%,
              // консолидировано из 20 подоменных записей после закрытия всех доменов/кабинетов.
              // Гибрид-harness: Pattern P (`renderToString`/node) для презентационных веток +
              // Pattern I (jsdom + `@testing-library/react`) для интерактива/эффектов/диалогов
              // (mock `HTMLDialogElement.prototype.showModal`/`close`; всегда-смонтированные
              // диалоги скоупятся `dialog[open]` + `within()`). Async server-компоненты
              // (`*-app-shell`, org-card async-табы, customer-access-section) — `await` + затем
              // `renderToString`. File-input формы — jsdom FileList-impl helper (React 19
              // `<form action>` строит FormData через jsdom, читая FileList impl, а не публичный
              // `files`). Барель `ui/index.ts` — в exclude выше. Каждый `/* v8 ignore */` —
              // structurally-unreachable defensive guard с причиной-комментарием. Широкий glob
              // (а не подоменный) ловит и будущие компоненты в новых подкаталогах.
              'src/components/**': { lines: 99.2, branches: 98.52, functions: 96.37, statements: 99.2 },
              // PHASE-3 W2 (app-страницы) — весь `src/app/**/*.tsx` (серверные `page.tsx`) под
              // порогом 100%. Harness `renderServerComponent` (jsdom): async-страница вызывается
              // напрямую (`await Page({ params/searchParams: Promise.resolve(...) })`), вложенные
              // async server-компоненты (шеллы/табы) мокаются на уровне модуля (у них своё
              // W1-покрытие), `redirect`/`notFound` — throw-сентинелы, деп-сервисы/prisma/auth/
              // featureFlags — `vi.mock`. Next-шеллы (layout/loading/error/…) — в exclude выше;
              // api-роуты (`.ts`) держит отдельный `src/app/api/**`. Каждый `/* v8 ignore */` —
              // single-line на structurally-unreachable defensive fallback (Paginator/TypeFilter).
              'src/app/**/*.tsx': { lines: 98.42, branches: 96.36, functions: 100, statements: 98.42 }
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
