import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/lib/acceptance/screenRules';
import { readSource } from './helpers/source';

/**
 * Границы суток считаются по Москве, а не по часовому поясу процесса.
 *
 * `new Date(...).setHours(0, 0, 0, 0)` даёт полночь в зоне процесса, а серверы
 * проекта живут в UTC (`date +%Z` на стенде — `UTC`, переменная `TZ` не
 * задана). С 00:00 до 03:00 по Москве такая «полночь» указывает на предыдущие
 * сутки московского календаря: удостоверение, истёкшее вчера, ещё считалось
 * действующим, «дела на сегодня» показывали вчерашний день. Наружу же всё
 * рендерится в `Europe/Moscow` (`lib/format.ts`), и расхождение видел только
 * тот, кто работает ночью.
 *
 * Это тот же дефект `Д-22`, что уже решён для года в номере документа
 * (`documents/generate.ts` берёт год через `Intl` в московской зоне).
 * Сопровождение `С-8` (08.09.2026) нашло его в сервисах; хотфикс №20 завёл
 * общий `startOfMoscowDay` и перевёл на него удостоверения и выгрузку
 * слушателей.
 *
 * Правило: в боевом коде нет `setHours(0, 0, 0, 0)` — начало суток берут
 * только из `startOfMoscowDay`.
 */
const ROOT = join(__dirname, '..', '..');
const MIDNIGHT = /setHours\(\s*0\s*,\s*0\s*,\s*0/;

/**
 * Вторая форма той же полуночи — сборка даты из частей часового пояса
 * процесса: `new Date(now.getFullYear(), now.getMonth(), 1)`,
 * `new Date(year, month - 1, 1)`, `new Date(new Date().getFullYear(), 0, 1)`.
 * Прежний шаблон её не видел, а промах крупнее: берётся не только час, но и
 * МЕСЯЦ. Замер на сервере (UTC): 1 сентября в 01:30 по Москве такой код
 * считает текущим месяцем август и отдаёт границу `01.08` — сводка «за этот
 * месяц» три часа подряд показывает весь прошлый (прогон №28).
 *
 * Формы записи разные, признак один: конструктор `Date` с НЕСКОЛЬКИМИ
 * аргументами всегда собирает дату в зоне процесса. Поэтому ищем не шаблон
 * текста, а сам вызов — иначе страж снова будет видеть одну форму из трёх.
 * `new Date(Date.UTC(...))` законен: там зона задана явно.
 */
function buildsLocalDate(src: string): boolean {
  for (const m of src.matchAll(/new Date\(/g)) {
    const args = argsOf(src, m.index + m[0].length);
    if (args === null) continue;
    if (args.length >= 2 && !/^\s*Date\.UTC\b/.test(args[0]!)) return true;
  }
  return false;
}

/** Аргументы вызова верхнего уровня начиная с позиции после `(`. */
function argsOf(src: string, from: number): string[] | null {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i]!;
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' && depth === 0) {
      args.push(current);
      return args;
    } else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      args.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  // Скобка не закрылась — разбирать нечего, но и молчать нельзя:
  // вызывающий просто не считает это место нарушением.
  /* v8 ignore next -- недостижимо на компилируемом исходнике: скобки в нём сбалансированы */
  return null;
}

/**
 * Места, где полночь процесса пока осталась, — с причиной у каждого.
 * Список существует, чтобы починка шла хотфиксами по три файла (§9.4), а не
 * одним большим PR. Пуст с прогона №28 (хотфиксы №51 и №52 закрыли и часы, и
 * месяцы с годами) — и должен таким оставаться.
 */
const PENDING: Array<{ file: string; why: string }> = [];

/**
 * Обход по КАТАЛОГАМ, а не по шаблону `src/lib/**​/*.ts`: в pathspec гита
 * `**​/` требует хотя бы одну подпапку, поэтому такой шаблон молча
 * пропускал файлы верхнего уровня — `lib/env.ts`, `lib/featureFlags.ts`,
 * `lib/format.ts`, `lib/quickTasks.ts`, `worker/index.ts`,
 * `worker/to-bull-processor.ts`. Среди них ровно те, ради которых страж и
 * заведён: форматирование дат и «дела на сегодня». Проба «добавить нарушение
 * в `lib/format.ts`» проходила зелёной (мутация `С-5`, прогон №26).
 */
function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src/lib', 'src/app', 'src/worker'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => !f.includes('__tests__'));
}

/** Файлы верхнего уровня — то, что прежний шаблон терял. Список не пуст. */
const TOP_LEVEL_SAMPLE = ['src/lib/format.ts', 'src/worker/index.ts'];

const rel = (f: string) => f.split(sep).join('/');

describe('даты: начало суток — по Москве (`Д-22`)', () => {
  const files = sourceFiles();

  it('обход видит файлы верхнего уровня, а не только вложенные', () => {
    // Прежний шаблон `src/lib/**​/*.ts` их терял, и страж молчал о
    // нарушении в `lib/format.ts`.
    for (const f of TOP_LEVEL_SAMPLE) {
      expect(files.map(rel), `${f} не попал в обход — страж снова слеп`).toContain(f);
    }
  });

  it('файлы находятся — обход не сломан', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('починенные места берут границу из startOfMoscowDay', () => {
    for (const f of [
      'src/lib/services/training/certificates.ts',
      'src/lib/services/organization/students.ts',
      'src/lib/services/manager/myDay.ts',
      'src/lib/services/organization/dashboard.ts',
      'src/lib/services/partner/dashboard.ts',
      // Прогон №28: границы МЕСЯЦА и года — та же ошибка, крупнее.
      'src/lib/services/admin/dashboard.ts',
      'src/worker/processors/calculate-monthly-commissions.ts',
      // Хотфикс №52 прогона №28: отчёты руководителя, реестр партнёров и
      // сетка календаря.
      'src/lib/services/leader/analytics.ts',
      'src/lib/services/admin/partners.ts',
      'src/lib/calendar/month.ts',
    ]) {
      // Комментарии не в счёт НИ ДЛЯ ОДНОЙ из двух проверок (хотфикс №47):
      // в пояснениях этих файлов встречаются и `setHours`, и сам
      // `startOfMoscowDay` — мутация «убрать вызов, оставить пояснение»
      // проходила зелёной.
      const src = readSource(join(ROOT, f));
      expect(src, `${f}: граница суток не из московского помощника`).toMatch(
        /startOfMoscow(Day|Month|Year)\(|moscowMonthRange\(|Europe\/Moscow/
      );
      expect(src, `${f}: вернулась полночь процесса`).not.toMatch(MIDNIGHT);
      expect(buildsLocalDate(src), `${f}: вернулась полночь процесса (сборка даты из частей)`).toBe(
        false
      );
    }
  });

  it('новых мест с полуночью процесса не появилось', () => {
    const pending = new Set(PENDING.map((e) => e.file));
    const offenders = files
      .filter((f) => {
        const src = stripComments(readFileSync(join(ROOT, f), 'utf8'));
        // Обе формы одной ошибки: и `setHours(0,0,0,0)`, и сборка даты из
        // частей зоны процесса. Вторую прежний шаблон пропускал (прогон №28).
        return MIDNIGHT.test(src) || buildsLocalDate(src);
      })
      .map(rel)
      .filter((f) => !pending.has(f));

    expect(
      offenders,
      'Полночь считается в часовом поясе процесса (сервер в UTC), а система ' +
        'обещает московское время: ночью такая граница указывает на предыдущие ' +
        'сутки. Возьми `startOfMoscowDay` из `lib/dates/calendar`:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('очередь не растёт молча: у каждого места записана причина и оно ещё не починено', () => {
    for (const e of PENDING) {
      const src = stripComments(readFileSync(join(ROOT, e.file), 'utf8'));
      expect(
        MIDNIGHT.test(src) || buildsLocalDate(src),
        `${e.file}: уже починено — убери из PENDING`
      ).toBe(true);
      expect(e.why.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
    }
  });
});
