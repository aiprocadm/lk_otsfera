import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж «нет тихих catch» (сопровождение, вопрос `В-1` → решение `Р-25`,
 * 05.09.2026).
 *
 * Прогон №1 нашёл в аудите входа (`recordAudit` в login/2FA/backup-кодах,
 * «выйти везде»), в отметке «последний вход» и в журнале синхронизации Mango
 * обработчик `.catch(() => {})`: запись аудита могла пропасть, и никто бы
 * не узнал. Решение — хелпер `bestEffort(label)` из `@/lib/logging`, который
 * пишет `log.warn(label, err)` и не роняет основное действие.
 *
 * Страж обходит `src/**` (без тестов и e2e) и ищет пустые обработчики:
 * `.catch(() => {})`, `.catch(() => undefined)`, `.catch(function () {})` и
 * пустые блоки `catch {}` / `catch (e) {}` без единого комментария внутри
 * (блок с записанной причиной — осознанное решение, он допустим).
 * Единственные допустимые места для стрелочных форм —
 * `ALLOWED` ниже, с точным числом вхождений и причиной: лишнее или пропавшее
 * вхождение там тоже ловится, чтобы список не устаревал.
 */

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const SKIP_DIRS = new Set(['__tests__', 'e2e']);

/** Файл → сколько тихих catch там допустимо и почему. */
const ALLOWED: Record<string, { count: number; why: string }> = {
  'src/worker/index.ts': {
    count: 2,
    why: 'Sentry.flush перед process.exit: log.error уже записан, процесс завершается — второй warn ничего не добавит',
  },
  'src/lib/services/auth/twoFactor.ts': {
    count: 1,
    why: 'discardTwoFactorChallenge: удаление уже истёкшего челленджа — отказ ожидаемый, не сигнал',
  },
};

const SILENT_CATCH = [
  /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g,
  /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*undefined\s*\)/g,
  /\.catch\(\s*function\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\)/g,
];
const EMPTY_BLOCK = /\bcatch\s*(\(\s*\w+\s*\))?\s*\{\s*\}/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** Комментарии не считаются: в них допустимо упоминать старый обработчик. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/**
 * Стрелочные `.catch(() => {})` ищутся по коду без комментариев. Пустой блок
 * `catch {}` — по сырому тексту: блок с комментарием внутри («сеть упала —
 * всё равно уходим на /login») не пустой, причина записана, это осознанное
 * решение, а не забытый обработчик.
 */
function countSilent(text: string): number {
  const code = stripComments(text);
  const arrows = SILENT_CATCH.reduce((n, re) => n + (code.match(re)?.length ?? 0), 0);
  return arrows + (text.match(EMPTY_BLOCK)?.length ?? 0);
}

describe('С-8/В-1: тихих `.catch(() => {})` и пустых `catch {}` в src нет', () => {
  const found = new Map<string, number>();
  for (const file of walk(SRC)) {
    const n = countSilent(readFileSync(file, 'utf8'));
    if (n > 0) found.set(path.relative(ROOT, file).split(path.sep).join('/'), n);
  }

  it('вне allow-list тихих обработчиков нет — используй bestEffort(label) из @/lib/logging', () => {
    const offenders = [...found]
      .filter(([file]) => !(file in ALLOWED))
      .map(([file, n]) => `${file} (${n})`);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('allow-list точен: каждое исключение на месте и ровно в том числе', () => {
    const drift = Object.entries(ALLOWED)
      .filter(([file, { count }]) => (found.get(file) ?? 0) !== count)
      .map(([file, { count }]) => `${file}: ожидалось ${count}, найдено ${found.get(file) ?? 0}`);
    expect(drift, drift.join('\n')).toEqual([]);
  });

  it('у каждого исключения записана причина', () => {
    for (const [file, { why }] of Object.entries(ALLOWED)) {
      expect(why.length, file).toBeGreaterThan(20);
    }
  });
});
