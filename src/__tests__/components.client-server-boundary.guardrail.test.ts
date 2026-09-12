import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * Страж границы «клиент ↔ сервер» (спека мессенджеров 2026-09-12; сборка
 * стенда после #581 упала и откатилась).
 *
 * Клиентский компонент (`'use client'`) попадает в браузерный бандл вместе со
 * ВСЕМ, что импортирует — транзитивно. Стоит чистому на вид модулю
 * (`services/messengers/channels.ts`) подтянуть серверный клиент бота, а тому —
 * кэш настроек с `node:crypto`, и `next build` падает с «Reading from
 * "node:crypto" is not handled by plugins». Ни `typecheck`, ни `lint`, ни
 * `test:unit` этого не видят: в Node всё импортируется без ошибок. Поймал
 * только стенд — откатом на прежнюю версию.
 *
 * Страж обходит граф импортов от каждого клиентского компонента по
 * `@/`-алиасам и относительным путям и падает, если по пути встречается
 * модуль с `node:`-встроенным, `server-only` или клиентом базы. Проверено
 * мутацией: на коде #581 падает на `new-dialog-button.tsx`.
 */
const SRC = join(process.cwd(), 'src');
const COMPONENTS = join(SRC, 'components');

/** Признаки серверного модуля — то, чего в браузерном бандле быть не может. */
const SERVER_MARKERS: ReadonlyArray<[RegExp, string]> = [
  [/from\s+'node:[a-z_]+'/, 'node:-встроенный модуль'],
  [/import\s+'server-only'/, 'server-only'],
  [/from\s+'@\/lib\/db\/prisma'/, 'клиент базы данных'],
];

/** `import … from '…'` и `export … from '…'`; `import type` бандл не тянет. */
const IMPORT_RE = /^\s*(?:import|export)\s+(?!type\s)[^'";]*?from\s+'([^']+)'/gm;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // npm-пакеты не обходим
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const sourceCache = new Map<string, string>();
function sourceOf(file: string): string {
  let src = sourceCache.get(file);
  if (src === undefined) {
    src = readFileSync(file, 'utf8');
    sourceCache.set(file, src);
  }
  return src;
}

function isClientComponent(src: string): boolean {
  return /^\s*'use client';?/m.test(src.split('\n').slice(0, 5).join('\n'));
}

function serverMarkerOf(src: string): string | null {
  for (const [re, label] of SERVER_MARKERS) if (re.test(src)) return label;
  return null;
}

/** Первый найденный путь от клиентского компонента к серверному модулю. */
function findServerReach(start: string): string[] | null {
  const seen = new Set<string>([start]);
  const queue: string[][] = [[start]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const file = path[path.length - 1]!;
    const src = sourceOf(file);
    if (file !== start) {
      const marker = serverMarkerOf(src);
      if (marker) return [...path, `→ ${marker}`];
    }
    for (const m of src.matchAll(IMPORT_RE)) {
      const next = resolveImport(file, m[1]!);
      if (!next || seen.has(next)) continue;
      // Серверные действия — граница по построению: Next заменяет их на stub.
      if (next.includes(join('src', 'server-actions'))) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return null;
}

describe('клиентские компоненты не дотягиваются до серверных модулей', () => {
  it('ни один `use client`-компонент не импортирует (транзитивно) node:-модули, server-only или базу', () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS)) {
      if (!isClientComponent(sourceOf(file))) continue;
      const reach = findServerReach(file);
      if (reach) offenders.push(reach.map((p) => relative(process.cwd(), p)).join('\n    → '));
    }
    expect(
      offenders,
      `Клиентский компонент тянет серверный код в браузерный бандл (next build упадёт):\n  ${offenders.join('\n  ')}`
    ).toEqual([]);
  });
});
