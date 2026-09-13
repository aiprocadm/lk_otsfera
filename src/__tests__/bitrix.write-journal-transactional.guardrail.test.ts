import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { readSource } from './helpers/source';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-196`): журнал пакета — ЕДИНСТВЕННЫЙ способ откатить
 * перенос. Запись сущности без строки журнала означает «изменили базу и не
 * знаем, как вернуть», а откат у этого этапа — требование приёмки.
 *
 * Поэтому правило жёсткое: каждый писатель, который создаёт или обновляет
 * строку в базе, обязан позвать `writeJournal` В ТОЙ ЖЕ функции и с тем же
 * `tx`. Самый вероятный регресс — «вынесу запись журнала наверх, в конвейер,
 * там удобнее»: тогда журнал уедет из транзакции строки, и упавшая запись
 * оставит след о том, чего не произошло.
 *
 * Страж читает исходник без комментариев (`readSource`): упоминание
 * `writeJournal` в пояснении сверху файла записью не считается.
 */
const ROOT = process.cwd();
const WRITERS_DIR = path.join(ROOT, 'src/lib/services/bitrix/writers');

/** Служебные помощники, которые сами в базу не пишут. */
const NOT_A_WRITER = new Set(['writeJournal', 'applyUpdate']);

/** Запись в базу внутри транзакции: `tx.<модель>.create(` и соседи. */
const DB_WRITE = /\btx\.[a-zA-Z]+\.(?:create|createMany|update|updateMany|upsert)\(/;

type Fn = { file: string; name: string; body: string };

/** Разбор файла на объявления функций верхнего уровня. */
function functionsOf(file: string): Fn[] {
  const src = readSource(file);
  const starts: { name: string; at: number }[] = [];
  // Скобка ИЛИ угловая: обобщённая функция (`applyUpdate<T>`) иначе не нашлась
  // бы, и весь общий путь обновления остался бы вне проверки.
  for (const m of src.matchAll(/^(?:export )?async function (\w+)\s*[<(]/gm)) {
    starts.push({ name: m[1]!, at: m.index });
  }
  return starts.map((s, i) => ({
    file,
    name: s.name,
    body: src.slice(s.at, starts[i + 1]?.at ?? src.length),
  }));
}

const FILES = readdirSync(WRITERS_DIR)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => path.join(WRITERS_DIR, f));

const FUNCTIONS = FILES.flatMap(functionsOf).filter((f) => !NOT_A_WRITER.has(f.name));

describe('У-196: журнал пакета пишется в одной транзакции с самой записью', () => {
  it('писатели найдены — обход не сломан', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(4);
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(8);
  });

  it('каждая функция, пишущая в базу, зовёт writeJournal рядом и с тем же tx', () => {
    const offenders: string[] = [];
    for (const fn of FUNCTIONS) {
      if (!DB_WRITE.test(fn.body)) continue;
      const rel = path.relative(ROOT, fn.file);
      if (!/\bwriteJournal\(/.test(fn.body)) {
        offenders.push(`${rel}: ${fn.name} пишет в базу без строки журнала`);
        continue;
      }
      // Журнал обязан получить ту же транзакцию: `writeJournal(prisma, …)`
      // записался бы отдельно от строки и пережил бы откат транзакции.
      if (!/\bwriteJournal\(\s*tx\s*,/.test(fn.body)) {
        offenders.push(`${rel}: ${fn.name} зовёт writeJournal не с tx`);
      }
    }
    expect(
      offenders,
      'запись без журнала нельзя откатить — откат требование приёмки `У-196`:\n'
    ).toEqual([]);
  });

  it('общий помощник обновления тоже журналирует своей транзакцией', () => {
    // `applyUpdate` — единственное место, где строку пишет не сам писатель, а
    // переданный ему обратный вызов. Если журнал уедет отсюда, все обновления
    // разом станут неоткатываемыми, а стража на писателях это не покажет.
    const fn = FILES.flatMap(functionsOf).find((f) => f.name === 'applyUpdate');
    expect(fn, 'помощник обновления не найден — обход сломан').toBeDefined();
    expect(fn!.body).toMatch(/\bwriteJournal\(\s*tx\s*,/);
  });

  it('сам writeJournal пишет строку журнала транзакцией, а не глобальным клиентом', () => {
    const src = readSource(path.join(WRITERS_DIR, 'journal.ts'));
    expect(src).toMatch(/\btx\.bitrixImportWrite\.create\(/);
    // Ни одного проглатывания: журнал намеренно НЕ fail-open (в отличие от
    // журнала импорта 1С) — не записался журнал, не должно быть и строки.
    expect(src).not.toMatch(/bitrixImportWrite\.create\([\s\S]*?\)\s*\.catch\(/);
  });
});
