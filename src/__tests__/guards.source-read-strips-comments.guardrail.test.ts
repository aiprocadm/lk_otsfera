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
 * Долг ниже — стражи, которые ещё читают исходник сырым текстом. Их переводят
 * поштучно, по нескольку за прогон: разом менять чтение у двух десятков
 * стражей рискованнее, чем сама дыра.
 *
 * **Список был дополнен один раз — в прогоне №28, и это не отступление, а
 * исправление счёта.** Прежде правило действовало только на стражей, у
 * которых проверка наличия записана матчером (`.toContain`, `.toMatch`).
 * Стражи, где та же проверка спрятана внутри логики
 * (`!src.includes('nameKey')`, а наружу `expect(offenders).toEqual([])`),
 * получали ноль и выпадали из проверки целиком — то есть долг всё это время
 * считался меньше, чем он есть. Счётчик починен, правило распространено на
 * ЛЮБОЕ чтение кода: проверке отсутствия снятие комментариев не вредит
 * (закомментированное нарушение — не нарушение), а проверке наличия спасает.
 * Дальше список может только уменьшаться — новый страж в него не попадёт и
 * обязан соблюдать правило сразу.
 */
const DEBT = new Set([
  'auth.teamMode-required',
  'components.upload-size-hint',
  'config.upload-formats',
  'docs.live-links',
  'errors.codes-covered',
  'help.glossary',
  'notifications.registry',
  'prisma.enum-terminal-last',
  'security.order-deal-visibility',
  'security.role-model-inventory',
  // Добавлены прогоном №28 вместе с починкой счёта (см. шапку). До неё они
  // не числились нарушителями лишь потому, что их проверки наличия были
  // невидимы счётчику.
  'components.no-db-import',
  'config.env-example',
  'docs.commands-exist',
  'e4.no-network',
  'import.no-second-writer',
  'navigation.same-section-same-name',
  'security.client-visibility',
  'security.document-status',
  'security.role-access-matrix',
  'server-actions.async-exports',
  'server-actions.session-guard',
  'services.graceful-degrade',
  'services.no-test-only-modules',
  'services.stable-pagination-order',
  'worker.processor-coverage',
]);

/**
 * Стражи, которые читают вообще НЕ код продукта. Отдельный список, а не
 * подстрока в тексте вызова: путь часто прячется в переменной
 * (`readFileSync(file)`), и сопоставление по тексту такие вызовы не узнаёт.
 */
const READS_NOT_CODE = new Set(['prisma.migrations-plain-sql']);

const TESTS_DIR = __dirname;
const name = (file: string) => file.replace('.guardrail.test.ts', '');

function countAll(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

/**
 * Проверка наличия, записанная НЕ матчером, а булевым выражением:
 * `expect(src.includes('X')).toBe(true)`, `expect(/re/.test(src)).toBe(true)`.
 *
 * Прежний счётчик знал только `.toContain(` и `.toMatch(`, поэтому страж,
 * написанный в таком стиле, получал ноль и выпадал из ОБЕИХ проверок целиком
 * — то есть правило на него не действовало вовсе. Это не теория: так уже жили
 * `import.no-second-writer` и `import.org-name-key`, и в списке долга их не
 * было (прогон №28). Заодно рушилось обещание из шапки «новый страж в долг не
 * попадёт и обязан соблюдать правило сразу».
 */
function booleanPresenceChecks(src: string): number {
  let n = 0;
  for (const m of src.matchAll(/expect\(([\s\S]{0,300}?)\)\s*\.\s*toBe\(true\)/g)) {
    if (/\.includes\(|\.test\(|\.some\(/.test(m[1]!)) n += 1;
  }
  return n;
}

/** Сколько в страже проверок НАЛИЧИЯ строки (без `.not.`). */
function presenceChecks(src: string): number {
  return (
    countAll(src, '.toContain(') -
    countAll(src, '.not.toContain(') +
    countAll(src, '.toMatch(') -
    countAll(src, '.not.toMatch(') +
    booleanPresenceChecks(src)
  );
}

/** Имя самого этого стража: он читает тесты, а не исходники продукта. */
const SELF = 'guards.source-read-strips-comments.guardrail.test.ts';

/**
 * Текст каждого вызова `readFileSync(...)` — от имени до закрывающей скобки,
 * плюс признак «обёрнут в `stripComments(`»: такая обёртка равносильна
 * `readSource` и правило не нарушает.
 */
function rawReadCalls(src: string): Array<{ call: string; wrapped: boolean }> {
  const out: Array<{ call: string; wrapped: boolean }> = [];
  const needle = 'readFileSync(';
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return out;
    from = at + needle.length;
    let depth = 1;
    let i = from;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    out.push({
      call: src.slice(at, i),
      wrapped: src.slice(Math.max(0, at - 15), at).includes('stripComments('),
    });
  }
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

  it('ни одного сырого чтения кода в обход помощника', () => {
    // Мало импортировать помощник: страж мог снимать комментарии в одном месте
    // и читать сырым `readFileSync` в другом. Так и было у
    // `dates.moscow-day-boundary`: вторая проверка комментарии снимала, первая
    // — нет, и мутация «убрать вызов `startOfMoscowDay`, оставить пояснение»
    // проходила зелёной в самом чувствительном месте (граница суток, `Д-22`).
    // Сырое чтение разрешено только для НЕ-кода: разметки, `.env`-примеров,
    // `schema.prisma`, `package.json` — там снятие `//` испортило бы ссылки.
    // `.sql` — тоже не код продукта: миграции читают как есть, и снятие `//`
    // там ничего не даёт (у SQL свой синтаксис комментариев).
    const NOT_CODE = [
      '.md',
      '.env',
      '.prisma',
      '.sql',
      'package.json',
      'package-lock',
      'snapshots',
    ];
    const offenders: string[] = [];

    for (const g of guards) {
      if (DEBT.has(name(g.file)) || g.file === SELF) continue;
      if (READS_NOT_CODE.has(name(g.file))) continue;
      // Раньше здесь стояло `if (presenceChecks(g.src) === 0) continue;` —
      // и правило не действовало на стражей, у которых проверка наличия
      // спрятана ВНУТРИ логики, а наружу выставлено `expect(offenders)
      // .toEqual([])`. Так живёт `import.org-name-key`: `!src.includes
      // ('nameKey')` — это проверка наличия, но `expect` выглядит проверкой
      // отсутствия, и счётчик давал ноль (прогон №28). Считаем правило общим:
      // проверке ОТСУТСТВИЯ снятие комментариев не вредит (закомментированное
      // нарушение — не нарушение), а проверке наличия — спасает.
      for (const { call, wrapped } of rawReadCalls(g.src)) {
        if (!wrapped && !NOT_CODE.some((m) => call.includes(m))) {
          offenders.push(`${g.file}: ${call.replace(/\s+/g, ' ').slice(0, 80)}`);
        }
      }
    }

    expect(offenders, `сырое чтение кода в обход readSource:\n${offenders.join('\n')}`).toEqual([]);
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
