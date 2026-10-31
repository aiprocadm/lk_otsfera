import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-342` (ТЗ 28.10.2026, ДП §4/§8): у каждого релиза в CHANGELOG — блок
 * «Миграции и совместимость»: что с базой и контрактами и как откатиться.
 * Требование вводится с релиза после 0.11.0 — старые записи не переписываются
 * (исторические документы не правят).
 */

const CHANGELOG = readFileSync(join(process.cwd(), 'CHANGELOG.md'), 'utf8');
const BLOCK = '### Миграции и совместимость';
/** Последний релиз до введения правила. */
const LAST_WITHOUT_BLOCK = [0, 11, 0];

function sections(): Array<{ title: string; version: number[] | null; text: string }> {
  const parts = CHANGELOG.split(/^## /m).slice(1);
  return parts.map((p) => {
    const title = p.split('\n', 1)[0]!.trim();
    const m = /^\[(\d+)\.(\d+)\.(\d+)\]/.exec(title);
    return { title, version: m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null, text: p };
  });
}

function newer(v: number[], base: number[]): boolean {
  for (let i = 0; i < 3; i++) if (v[i] !== base[i]) return v[i]! > base[i]!;
  return false;
}

describe('CHANGELOG: блок «Миграции и совместимость» у каждого нового релиза (У-342)', () => {
  it('у [Unreleased] блок есть', () => {
    const unreleased = sections().find((s) => s.title.startsWith('[Unreleased]'));
    expect(unreleased?.text).toContain(BLOCK);
  });

  it('у каждого релиза новее 0.11.0 блок есть', () => {
    const missing = sections()
      .filter((s) => s.version && newer(s.version, LAST_WITHOUT_BLOCK))
      .filter((s) => !s.text.includes(BLOCK))
      .map((s) => s.title);
    expect(missing).toEqual([]);
  });
});
