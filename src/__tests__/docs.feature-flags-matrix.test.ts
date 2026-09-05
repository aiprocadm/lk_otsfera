import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FEATURE_FLAGS, isOptInFlag, type FeatureFlag } from '@/lib/featureFlags';

/**
 * Страж «реестр флагов ↔ документация» (хотфикс №1 сопровождения, находка
 * С-7 от 05.09.2026).
 *
 * `docs/feature-flags-matrix.md` обещает быть реестром **всех** флагов с их
 * классом (opt-out / opt-in) — на него ссылаются RUNBOOK, CI.md и чек-лист
 * PR. Расходился он молча: за два месяца документ описал 25 флагов из 30,
 * держал строку удалённого `partner_leads` и относил opt-out
 * `document_generation` к opt-in. Оператор, читающий матрицу перед релизом,
 * не узнал бы о шести флагах и выставил бы env не тому классу.
 *
 * Проверяются три вещи: множество флагов в таблицах равно `FEATURE_FLAGS`,
 * каждый флаг стоит в таблице своего класса, счётчики в шапке совпадают с
 * кодом. Плюс runbook запуска: его таблица — подмножество реестра, но
 * призраков и чужого класса в ней быть не должно.
 */

const ROOT = process.cwd();
const MATRIX_PATH = path.join(ROOT, 'docs', 'feature-flags-matrix.md');
const LAUNCH_RUNBOOK_PATH = path.join(ROOT, 'docs', 'runbook-launch-deploy.md');

function read(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** Разделы второго уровня: заголовок → текст до следующего `## `. */
function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = md.split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    out.set(part.slice(0, nl).trim(), part.slice(nl + 1));
  }
  return out;
}

/** Первая колонка строк таблицы вида «| `flag` | … |». */
function tableFlags(text: string): string[] {
  return [...text.matchAll(/^\| `([a-z0-9_]+)` \|/gm)].map((m) => m[1]!);
}

function sectionByPrefix(all: Map<string, string>, prefix: string): string {
  const key = [...all.keys()].find((k) => k.startsWith(prefix));
  expect(
    key,
    `В docs/feature-flags-matrix.md нет раздела «## ${prefix}…» — таблицы классов ` +
      'флагов читаются по этим заголовкам.'
  ).toBeDefined();
  return all.get(key!)!;
}

const code = {
  optOut: FEATURE_FLAGS.filter((f) => !isOptInFlag(f)),
  optIn: FEATURE_FLAGS.filter((f) => isOptInFlag(f)),
};

describe('docs/feature-flags-matrix.md ↔ src/lib/featureFlags.ts', () => {
  const md = read(MATRIX_PATH);
  const secs = sections(md);
  const doc = {
    optOut: tableFlags(sectionByPrefix(secs, 'Opt-out')),
    optIn: tableFlags(sectionByPrefix(secs, 'Opt-in')),
  };
  const documented = [...doc.optOut, ...doc.optIn];

  it('каждый флаг из кода описан в матрице', () => {
    const missing = FEATURE_FLAGS.filter((f) => !documented.includes(f));
    expect(
      missing,
      'Флаг есть в FEATURE_FLAGS, а в docs/feature-flags-matrix.md строки нет — ' +
        'допиши её в таблицу своего класса (opt-out / opt-in):\n'
    ).toEqual([]);
  });

  it('в матрице нет флагов, которых нет в коде', () => {
    const known = new Set<string>(FEATURE_FLAGS);
    const phantom = documented.filter((f) => !known.has(f));
    expect(
      phantom,
      'Матрица описывает флаг, которого в FEATURE_FLAGS нет — удали строку ' +
        '(так три месяца жил удалённый partner_leads):\n'
    ).toEqual([]);
  });

  it('флаг описан ровно один раз', () => {
    const dup = documented.filter((f, i) => documented.indexOf(f) !== i);
    expect(dup, 'Флаг встречается в таблицах матрицы дважды:\n').toEqual([]);
  });

  it('opt-out флаги стоят в таблице opt-out, opt-in — в таблице opt-in', () => {
    const misplaced = [
      ...doc.optOut.filter((f) => isOptInFlag(f as FeatureFlag)),
      ...doc.optIn.filter(
        (f) => FEATURE_FLAGS.includes(f as FeatureFlag) && !isOptInFlag(f as FeatureFlag)
      ),
    ];
    expect(
      misplaced,
      'Флаг стоит в таблице не своего класса — у opt-out «забытый env» = включён, ' +
        'у opt-in = выключен; оператор по этой таблице решает, что выставлять:\n'
    ).toEqual([]);
  });

  it('счётчики в шапке совпадают с кодом', () => {
    const m = md.match(/\((\d+) флагов: (\d+) opt-out[^,]*, (\d+) opt-in/);
    expect(
      m,
      'В шапке матрицы не найдено «(N флагов: A opt-out …, B opt-in …)» — ' +
        'по этим числам страж сверяет документ с кодом.'
    ).not.toBeNull();
    expect({ total: Number(m![1]), optOut: Number(m![2]), optIn: Number(m![3]) }).toEqual({
      total: FEATURE_FLAGS.length,
      optOut: code.optOut.length,
      optIn: code.optIn.length,
    });
  });
});

describe('docs/runbook-launch-deploy.md: таблица флагов запуска', () => {
  const md = read(LAUNCH_RUNBOOK_PATH);
  // Строки «| `flag` | `FEATURE_…` | класс |» — только одиночные флаги;
  // сводная строка «`a` / `b` / `c`» первой колонкой под regex не подходит.
  const rows = [
    ...md.matchAll(/^\| `([a-z0-9_]+)` \| `FEATURE_[A-Z0-9_]+` \| (opt-in|opt-out) \|/gm),
  ];

  it('таблица не пуста и называет только существующие флаги', () => {
    expect(rows.length).toBeGreaterThan(0);
    const known = new Set<string>(FEATURE_FLAGS);
    const phantom = rows.map((r) => r[1]!).filter((f) => !known.has(f));
    expect(
      phantom,
      'Runbook запуска называет флаг, которого в FEATURE_FLAGS нет — удали строку:\n'
    ).toEqual([]);
  });

  it('класс флага в runbook совпадает с кодом', () => {
    const wrong = rows
      .filter((r) => FEATURE_FLAGS.includes(r[1] as FeatureFlag))
      .filter((r) => (r[2] === 'opt-in') !== isOptInFlag(r[1] as FeatureFlag))
      .map((r) => `${r[1]}: в runbook ${r[2]}`);
    expect(wrong, 'Класс флага в runbook запуска расходится с OPT_IN_FLAGS:\n').toEqual([]);
  });
});
