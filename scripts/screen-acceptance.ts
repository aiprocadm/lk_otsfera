/**
 * Приёмка §0 действующего ТЗ по исходникам (`У-175`, этап 9).
 *
 * Запуск руками, в гейты не входит:
 *
 *   npx tsx scripts/screen-acceptance.ts screens [--base 92c683e] [--head main]
 *                                                 [--sample 12] [--seed 175] [--depth 3]
 *
 * Режим `screens` берёт список экранов, изменённых программой
 * (`git diff --name-status <base> <head> -- 'src/app/**\/page.tsx'`), по каждому
 * собирает цепочку «страница + её компоненты из `src/components/**`» (в глубину
 * `--depth`) и проверяет три вопроса §15 CLAUDE.md. Итог — markdown-таблица
 * «кабинет → экранов → где я / что здесь / что дальше» для close-out этапа,
 * список экранов с пробелами и воспроизводимая выборка `--sample` экранов
 * для проверки глазами (`pickSample`, зерно `--seed`).
 *
 * Исходники читаются из рабочего дерева: починил экран — перезапустил и увидел.
 * Сами правила — чистые функции в `src/lib/acceptance/screenRules.ts`, у них
 * есть юнит-тест; здесь только диск, git и печать.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  analyzeScreen,
  cabinetOf,
  componentImports,
  findGaps,
  pickSample,
  renderSummary,
  routeOf,
  summarize,
  type ScreenRow,
} from '../src/lib/acceptance/screenRules';

const ROOT = join(__dirname, '..');

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v ?? fallback;
}

const COMPONENTS = join(ROOT, 'src', 'components');

/**
 * `@/components/x` или `./x` → путь к файлу, если он есть и лежит в
 * `src/components/**` (относительный импорт из страницы может вести и в
 * `src/app/**` — такие компоненты тоже часть экрана, их берём).
 */
function resolveImport(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, 'src', spec.slice(2)) : join(dirname(from), spec);
  if (!base.startsWith(COMPONENTS) && !base.startsWith(join(ROOT, 'src', 'app'))) return null;
  for (const cand of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Страница и её компоненты вглубь: barrel `ui/index.ts` раскрывается тоже. */
function chainOf(page: string, depth: number): string[] {
  const files: string[] = [];
  const visit = (file: string, level: number) => {
    if (files.includes(file) || level > depth) return;
    files.push(file);
    const src = readFileSync(file, 'utf8');
    for (const spec of componentImports(src)) {
      const f = resolveImport(spec, file);
      if (f) visit(f, level + 1);
    }
  };
  visit(page, 0);
  return files;
}

function changedPages(base: string, head: string): Array<{ file: string; status: 'A' | 'M' }> {
  const out = execFileSync(
    'git',
    ['diff', '--name-status', base, head, '--', 'src/app/**/page.tsx'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  const rows: Array<{ file: string; status: 'A' | 'M' }> = [];
  for (const line of out.split('\n')) {
    const cells = line.split('\t');
    const code = cells[0]?.[0];
    // Удалённые экраны проверять нечего; переименованные — по новому пути.
    if (!code || code === 'D') continue;
    const file = cells[cells.length - 1] as string;
    if (!existsSync(join(ROOT, file))) continue;
    rows.push({ file, status: code === 'A' ? 'A' : 'M' });
  }
  return rows;
}

function screens(): void {
  const base = arg('base', '92c683e');
  const head = arg('head', 'main');
  const sample = Number(arg('sample', '12'));
  const seed = Number(arg('seed', '175'));
  const depth = Number(arg('depth', '3'));

  const rows: ScreenRow[] = changedPages(base, head).map(({ file, status }) => {
    const chain = chainOf(join(ROOT, file), depth);
    return {
      file,
      route: routeOf(file),
      cabinet: cabinetOf(file),
      status,
      signals: analyzeScreen(chain.map((f) => readFileSync(f, 'utf8'))),
    };
  });

  const fresh = rows.filter((r) => r.status === 'A');
  const lines: string[] = [];
  lines.push(`## Приёмка §0 по исходникам — ${base}..${head}`);
  lines.push('');
  lines.push(
    `Экранов: ${rows.length} (новых ${fresh.length}, изменённых ${rows.length - fresh.length}); цепочка «страница + компоненты» в глубину ${depth}.`
  );
  lines.push('');
  lines.push(renderSummary(summarize(rows)));
  lines.push('');

  const cards = rows.filter((r) => r.signals.subtitle === 'card');
  if (cards.length > 0) {
    lines.push(
      `Карточки без подзаголовка (\`subtitle={null}\`, исключения стража \`pages.subtitles.guardrail\`): ${cards
        .map((r) => `\`${r.route}\``)
        .join(', ')}.`
    );
    lines.push('');
  }

  const gateways = rows.filter((r) => r.signals.gateway);
  if (gateways.length > 0) {
    lines.push(
      `Шлюзы старых адресов (своего экрана нет): ${gateways.map((r) => `\`${r.route}\``).join(', ')}.`
    );
    lines.push('');
  }

  const gaps = findGaps(rows);
  lines.push(`### Экраны с пробелами: ${gaps.length}`);
  lines.push('');
  for (const g of gaps) {
    lines.push(`- \`${g.route}\` (${g.file}) — ${g.missing.join('; ')}`);
  }
  if (gaps.length === 0) lines.push('- нет');
  lines.push('');

  // Шлюз смотреть глазами нечего — он сразу уводит на настоящий экран.
  const candidates = fresh.filter((r) => !r.signals.gateway).map((r) => r.file);
  lines.push(
    `### Выборка глазами: ${sample} из ${candidates.length} новых экранов без шлюзов (seed=${seed})`
  );
  lines.push('');
  for (const f of pickSample(candidates, sample, seed)) {
    lines.push(`- \`${routeOf(f)}\` (${f})`);
  }
  lines.push('');

  process.stdout.write(lines.join('\n'));
  process.exitCode = gaps.length > 0 ? 1 : 0;
}

const mode = process.argv[2];
if (mode === 'screens') {
  screens();
} else {
  process.stderr.write(
    'Использование: tsx scripts/screen-acceptance.ts screens [--base <коммит>] [--head <ветка>] [--sample N] [--seed N] [--depth N]\n'
  );
  process.exitCode = 2;
}
