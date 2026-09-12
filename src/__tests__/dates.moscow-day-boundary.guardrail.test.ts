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
 * Места, где полночь процесса пока осталась, — с причиной у каждого.
 * Список существует, чтобы починка шла хотфиксами по три файла (§9.4), а не
 * одним большим PR. Пуст с 08.09.2026 (хотфикс №21 закрыл «дела на сегодня» и
 * оба дашборда) — и должен таким оставаться.
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
    ]) {
      // Комментарии не в счёт НИ ДЛЯ ОДНОЙ из двух проверок (хотфикс №47):
      // в пояснениях этих файлов встречаются и `setHours`, и сам
      // `startOfMoscowDay` — мутация «убрать вызов, оставить пояснение»
      // проходила зелёной.
      const src = readSource(join(ROOT, f));
      expect(src, `${f}: граница суток не из startOfMoscowDay`).toContain('startOfMoscowDay(');
      expect(src, `${f}: вернулась полночь процесса`).not.toMatch(MIDNIGHT);
    }
  });

  it('новых мест с полуночью процесса не появилось', () => {
    const pending = new Set(PENDING.map((e) => e.file));
    const offenders = files
      .filter((f) => MIDNIGHT.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))))
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
      expect(MIDNIGHT.test(src), `${e.file}: уже починено — убери из PENDING`).toBe(true);
      expect(e.why.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
    }
  });
});
