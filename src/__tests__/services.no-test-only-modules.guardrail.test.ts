import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Сервис, который зовут только тесты, — мёртвый код с живым стражем.
 *
 * `npm run deadcode` (knip) считает импорт из `src/__tests__` использованием,
 * поэтому модуль, от которого ушли все экраны и скрипты, остаётся «живым»,
 * пока его держит тест. Так `partner/orgComments.ts` пережил переезд
 * партнёрской карточки на общую `organizationCard.ts` и полгода охранялся
 * IDOR-тестом, который проверял путь, по которому никто не ходит (найдено
 * сопровождением `С-6`, 06.09.2026, хотфикс №12).
 *
 * Правило: у каждого модуля `src/lib/services/**` есть хотя бы один
 * импортёр вне тестов — в `src/` (экраны, роуты, воркер, другие сервисы)
 * в `scripts/` (одноразовые инструменты запускаются оттуда) или в `prisma/`
 * (seed зовёт бэкфиллы). Нет — модуль либо удаляют вместе с тестом, либо
 * тест переводят на живой путь.
 */
const ROOT = resolve(__dirname, '..', '..');
const SERVICES_ROOT = join(ROOT, 'src', 'lib', 'services');
const IMPORTER_ROOTS = [join(ROOT, 'src'), join(ROOT, 'scripts'), join(ROOT, 'prisma')];
const IMPORT_RE = /(?:from|import\(|require\()\s*['"]([^'"]+)['"]/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(ts|tsx|mjs)$/.test(e.name) ? [p] : [];
  });
}

/** Тесты и e2e-обход в счёт не идут — иначе страж повторит слепоту knip. */
function isTestLike(file: string): boolean {
  const rel = relative(ROOT, file);
  return (
    rel.startsWith(join('src', '__tests__')) ||
    rel.startsWith(join('src', 'e2e')) ||
    /\.(test|spec)\.(ts|tsx)$/.test(rel)
  );
}

/** Спецификатор импорта → абсолютный путь модуля (без расширения). */
function resolveSpecifier(from: string, spec: string): string | null {
  if (spec.startsWith('@/')) return join(ROOT, 'src', spec.slice(2));
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  return null;
}

/** Все файлы, на которые может указывать путь без расширения. */
function candidates(base: string): string[] {
  return [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
}

function moduleKeys(file: string): string[] {
  const keys = [file, file.replace(/\.tsx?$/, '')];
  if (/[\\/]index\.ts$/.test(file)) keys.push(dirname(file));
  return keys;
}

describe('services.no-test-only-modules: у каждого сервиса есть импортёр вне тестов', () => {
  it('ни один модуль src/lib/services/** не живёт только за счёт тестов', () => {
    const services = walk(SERVICES_ROOT).filter((f) => !isTestLike(f));
    // Смок против пустого обхода: страж без модулей зелёный не потому, что
    // всё хорошо, а потому, что смотрит не туда.
    expect(services.length).toBeGreaterThan(200);

    const importedFrom = new Map<string, Set<string>>();
    for (const root of IMPORTER_ROOTS) {
      if (!existsSync(root) || !statSync(root).isDirectory()) continue;
      for (const file of walk(root)) {
        if (isTestLike(file)) continue;
        const src = readFileSync(file, 'utf-8');
        for (const m of src.matchAll(IMPORT_RE)) {
          const base = resolveSpecifier(file, m[1] ?? '');
          if (!base) continue;
          for (const c of candidates(base)) {
            if (!importedFrom.has(c)) importedFrom.set(c, new Set());
            importedFrom.get(c)!.add(file);
          }
        }
      }
    }

    const orphans = services.filter((file) => {
      const importers = new Set<string>();
      for (const key of moduleKeys(file)) {
        for (const i of importedFrom.get(key) ?? []) importers.add(i);
      }
      importers.delete(file);
      return importers.size === 0;
    });

    expect(
      orphans.map((f) => relative(ROOT, f)),
      'Сервис не импортирует ни один файл вне тестов (экран, роут, воркер, ' +
        'сервис, scripts/ или prisma/seed) — это мёртвый код, который держит только тест. ' +
        'Удали модуль вместе с тестом или переведи тест на живой путь ' +
        '(эталон: security.idor-comments.integration → getOrganizationCard, хотфикс №12):\n'
    ).toEqual([]);
  });
});
