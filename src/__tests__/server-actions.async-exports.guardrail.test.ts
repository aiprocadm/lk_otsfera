import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Страж: из файла с `'use server'` экспортируются ТОЛЬКО async-функции.
 *
 * Next.js делает серверное действие из каждого экспорта такого файла, поэтому
 * синхронный `export function` роняет **production-сборку**:
 *
 *     Error: Server Actions must be async functions.
 *
 * Коварство в том, что `typecheck`, `lint` и весь unit-слой при этом зелёные —
 * ошибка видна только в `npm run build`. Так и случилось: синхронная
 * `sampleProps` уехала в `main` и **сутки блокировала обновление стенда** —
 * скрипт обновления каждые 10 минут собирал, падал и откатывался на старую
 * версию, поэтому семь влитых PR на стенд не попадали.
 *
 * Правило простое: нужна функция только внутри файла — не экспортируй её
 * (§12b); нужна снаружи — её место в `lib/`, а не среди серверных действий.
 */
const ACTIONS = join(__dirname, '..', 'server-actions');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/**
 * Экспорты верхнего уровня и то, допустимы ли они в `use server`-файле.
 *
 * Допустимы ровно два вида: `export async function` и
 * `export const x = async (…)`. Типы (`export type` / `export interface`)
 * при компиляции стираются, поэтому не считаются экспортом.
 */
function badExports(src: string): string[] {
  const bad: string[] = [];
  for (const line of src.split('\n')) {
    if (!line.startsWith('export')) continue;
    if (/^export\s+(type|interface)\b/.test(line)) continue;
    if (/^export\s+async\s+function\s/.test(line)) continue;
    if (/^export\s+const\s+[A-Za-z0-9_]+\s*=\s*async\s*\(/.test(line)) continue;
    const named = line.match(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_]+)/);
    bad.push(named ? (named[1] as string) : line.trim().slice(0, 60));
  }
  return bad;
}

describe('серверные действия: каждый экспорт — async-функция', () => {
  const files = walk(ACTIONS);

  it('файлы серверных действий вообще находятся — обход не сломан', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('ни один файл с `use server` не экспортирует ничего, кроме async-функций', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Директива стоит первой строкой файла.
      if (!/^\s*['"]use server['"]/.test(src)) continue;
      for (const name of badExports(src)) {
        offenders.push(`${relative(ACTIONS, file)} → ${name}`);
      }
    }
    expect(
      offenders,
      'из `use server`-файла можно экспортировать ТОЛЬКО async-функции. ' +
        'Синхронная функция или объект роняют `npm run build` ' +
        '(«Server Actions must be async functions» / «found object»), ' +
        'оставаясь невидимыми для typecheck, lint и тестов:\n'
    ).toEqual([]);
  });
});
