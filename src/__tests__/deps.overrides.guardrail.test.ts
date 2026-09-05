import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж «уязвимые транзитивные версии не возвращаются» (хотфикс №7
 * сопровождения, решение `Р-26` по вопросу `В-2`, 05.09.2026).
 *
 * `npm audit --omit=dev` показывал 7 уязвимостей, которые «чинятся только
 * мажором» — на деле дырявыми были не сами `next`/`prisma`/`exceljs`, а их
 * транзитивные зависимости с закреплённой старой версией: `postcss@8.4.31`
 * внутри `next`, `uuid@8.3.2` у `exceljs`, `deepmerge-ts@7.1.5` у
 * `@prisma/config`. Секция `overrides` в `package.json` поднимает их до
 * безопасных, мажоры остаются на месте.
 *
 * Страж читает `package-lock.json`: ни одна установленная копия этих трёх
 * пакетов (в любой глубине `node_modules/**`) не ниже безопасного порога, и
 * сами `overrides` на месте — иначе следующий `npm install` их вернёт.
 */

const ROOT = process.cwd();

/** Пакет → минимальная безопасная версия (граница из советов `npm audit`). */
const FLOORS: Record<string, string> = {
  postcss: '8.5.23', // GHSA: уязвимы <=8.5.22
  uuid: '11.1.1', // GHSA-w5hq-g745-h8pq: уязвимы <11.1.1
  'deepmerge-ts': '8.0.0', // GHSA-ggr8-5vv4-36mx: уязвимы <8
};

function parse(v: string): number[] {
  return v.split('-')[0]!.split('.').map(Number);
}

/** `a < b` для версий вида x.y.z (pre-release хвост отбрасывается). */
function lt(a: string, b: string): boolean {
  const [pa, pb] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  }
  return false;
}

describe('С-9/В-2: overrides держат транзитивные зависимости выше уязвимых версий', () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
    overrides?: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };

  it('в package.json есть override для каждого из трёх пакетов', () => {
    const missing = Object.keys(FLOORS).filter((name) => !pkg.overrides?.[name]);
    expect(missing, missing.join(', ')).toEqual([]);
  });

  it('в package-lock.json нет ни одной копии ниже безопасного порога', () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(lock.packages)) {
      const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const floor = FLOORS[name];
      if (!floor || !entry.version) continue;
      if (lt(entry.version, floor)) bad.push(`${key}@${entry.version} < ${floor}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('каждый из трёх пакетов действительно установлен (страж не проверяет пустоту)', () => {
    for (const name of Object.keys(FLOORS)) {
      const keys = Object.keys(lock.packages).filter((k) => k.endsWith(`node_modules/${name}`));
      expect(keys.length, name).toBeGreaterThan(0);
    }
  });
});
