import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Страж-над-стражами (`С-5`, прогон №26, хотфикс №47).
 *
 * Страж вида «в этом файле есть вызов `X()`» читает исходник текстом. Если
 * читать его как есть, то закомментированный вызов страж считает живым —
 * проверено мутацией на четырёх: `config.settings-from-ui` (прайм снапшота
 * флагов в `instrumentation.ts` и в воркере), `config.alerts` (токен телеграма
 * в доставке тревог), `email.templates` (подстановка своего шаблона письма) и
 * `api.documents-list-scope` (подпись под усечённым списком). Во всех четырёх
 * достаточно было приписать `//` перед строкой — страж оставался зелёным,
 * хотя для продукта комментирование и удаление это одно и то же.
 *
 * Правило: страж, который читает файлы И проверяет НАЛИЧИЕ строки, читает их
 * помощником [`readSource`](helpers/source.ts) (или снимает комментарии сам).
 * Проверки ОТСУТСТВИЯ (`not.toContain`) от комментариев не страдают — там
 * комментарий делает стража строже, а не слепее.
 *
 * Долг ниже — стражи, которые читают не только код (разметку `.md`,
 * `.env`-примеры, `schema.prisma`). Наивное снятие `//` съело бы в них ссылки
 * `https://…` вместе с остатком строки, поэтому их переводят поштучно, в
 * следующих прогонах. Список закрытый: он может только уменьшаться — новый
 * страж в него не попадёт и обязан соблюдать правило сразу.
 */
const DEBT = new Set([
  'auth.teamMode-required',
  'components.upload-size-hint',
  'config.upload-formats',
  'docs.live-links',
  'errors.codes-covered',
  'featureFlags.third-gate',
  'help.glossary',
  'notifications.registry',
  'prisma.enum-terminal-last',
  'security.order-deal-visibility',
  'security.role-model-inventory',
]);

const TESTS_DIR = __dirname;
const name = (file: string) => file.replace('.guardrail.test.ts', '');

function countAll(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

/** Сколько в страже проверок НАЛИЧИЯ строки (без `.not.`). */
function presenceChecks(src: string): number {
  return (
    countAll(src, '.toContain(') -
    countAll(src, '.not.toContain(') +
    countAll(src, '.toMatch(') -
    countAll(src, '.not.toMatch(')
  );
}

type Guard = { file: string; src: string };

const guards: Guard[] = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.guardrail.test.ts'))
  .map((f) => ({ file: f, src: readFileSync(join(TESTS_DIR, f), 'utf8') }));

describe('стражи, читающие исходник, не считают комментарий кодом', () => {
  it('в папке вообще есть стражи (иначе проверка ничего не значит)', () => {
    expect(guards.length).toBeGreaterThan(50);
  });

  it('каждый читающий страж с проверкой наличия снимает комментарии', () => {
    const offenders = guards
      .filter(
        (g) =>
          g.src.includes('readFileSync(') &&
          presenceChecks(g.src) > 0 &&
          !g.src.includes('readSource') &&
          !g.src.includes('stripComments') &&
          !DEBT.has(name(g.file))
      )
      .map((g) => g.file);

    expect(
      offenders,
      `эти стражи читают исходник как есть и считают вызовом закомментированный вызов:\n` +
        `${offenders.join('\n')}\n` +
        `почини чтение через helpers/source.ts (readSource)`
    ).toEqual([]);
  });

  it('список долга не содержит лишних имён', () => {
    const stale = [...DEBT].filter((n) => {
      const g = guards.find((x) => name(x.file) === n);
      // стража нет вовсе — запись протухла; страж уже соблюдает правило —
      // запись лишняя и её надо убрать, иначе долг перестаёт сокращаться.
      return !g || g.src.includes('readSource') || g.src.includes('stripComments');
    });
    expect(stale, `убери из списка долга: ${stale.join(', ')}`).toEqual([]);
  });

  it('помощник действительно снимает комментарии', () => {
    const src = readFileSync(join(TESTS_DIR, 'helpers', 'source.ts'), 'utf8');
    expect(src).toContain('stripComments(readFileSync(');
  });
});
