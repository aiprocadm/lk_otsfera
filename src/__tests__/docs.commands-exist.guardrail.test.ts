import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж «команды из документации существуют» (хотфикс №6 сопровождения,
 * находка С-7 от 05.09.2026).
 *
 * Три рабочих чеклиста (smoke-прогоны staging, runbook поэтапного
 * включения кабинетов) велели проверять воркер командой
 * `npm run worker:start` — такого скрипта в `package.json` нет
 * (есть `worker`), а один ещё и звал `dist/scripts/backfill-order-organization-id.js`,
 * удалённый после того, как колонка стала обязательной. Человек по чеклисту
 * упирался в «Missing script» посреди релиза.
 *
 * Проверяются две вещи по README, CLAUDE.md и `docs/**` (кроме `docs/tz`
 * и `docs/superpowers` — это реестры и архив планов, они честно описывают
 * то, что было): каждая `npm run <x>` есть в `scripts` package.json, каждый
 * упомянутый `scripts/<файл>` лежит на диске.
 */

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['tz', 'superpowers']);

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walkMd(full));
    } else if (name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const FILES = [
  path.join(ROOT, 'README.md'),
  path.join(ROOT, 'CLAUDE.md'),
  ...walkMd(path.join(ROOT, 'docs')),
];

function mentions(re: RegExp): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
      const key = m[1]!;
      const list = found.get(key) ?? [];
      list.push(path.relative(ROOT, file));
      found.set(key, list);
    }
  }
  return found;
}

describe('С-7: команды и скрипты из документации существуют', () => {
  const scripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    .scripts as Record<string, string>;

  it('каждая `npm run <x>` из README/CLAUDE.md/docs есть в package.json', () => {
    const missing = [...mentions(/npm run ([a-z0-9:_-]+)/g)]
      .filter(([name]) => !(name in scripts))
      .map(([name, files]) => `${name} ← ${[...new Set(files)].join(', ')}`)
      .sort();
    expect(
      missing,
      'Документация зовёт npm-скрипт, которого нет в package.json — поправь команду ' +
        'в документе или верни скрипт:\n'
    ).toEqual([]);
  });

  it('каждый упомянутый `scripts/<файл>` лежит на диске', () => {
    const missing = [...mentions(/\b(scripts\/[A-Za-z0-9_./-]+\.(?:ts|mjs|js|sh))/g)]
      .filter(([file]) => !existsSync(path.join(ROOT, file)))
      .map(([file, files]) => `${file} ← ${[...new Set(files)].join(', ')}`)
      .sort();
    expect(
      missing,
      'Документация ссылается на скрипт, которого нет — удали шаг или укажи ' +
        'действующий файл:\n'
    ).toEqual([]);
  });
});
