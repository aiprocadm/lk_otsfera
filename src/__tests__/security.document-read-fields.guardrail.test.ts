import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `У-164` — кто зовёт `canReadDocument`, обязан прислать ТИП и СОСТОЯНИЕ.
 *
 * **Зачем страж, а не проверка внутри гейта.** Гейт умеет перечитать документ
 * из базы, если данных не хватает, — но условие «данных хватает» намеренно не
 * требует типа и состояния: иначе каждый вызов без этих двух полей ходил бы в
 * базу второй раз на ровном месте, а таких вызовов шесть, и часть из них — в
 * цикле по списку документов.
 *
 * Цена такого решения — тихая дыра: вызывающий, забывший `type: true` в
 * выборке, не получит ни ошибки, ни падения. Гейт просто не увидит, что перед
 * ним ЧЕРНОВИК коммерческого предложения, и покажет клиенту бумагу, которую
 * ему ещё не отправляли, — с ценой, которую ещё не предлагали.
 *
 * Поэтому обязанность вынесена наружу и проверяется здесь: страж находит все
 * вызовы `canReadDocument` в боевом коде и требует, чтобы в том же файле
 * выборка документа брала `type` и `status`.
 */
const SRC = join(__dirname, '..');

/** Файлы, где встречается вызов гейта. Пустой обход — сломанный страж. */
function callers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === 'node_modules') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(name)) continue;
      const rel = relative(SRC, p).split('\\').join('/');
      // Сам гейт — не вызывающий: он и есть дверь.
      if (rel === 'lib/auth/policy.ts') continue;
      if (/\bcanReadDocument\(/.test(readFileSync(p, 'utf-8'))) out.push(rel);
    }
  };
  walk(SRC);
  return out;
}

describe('У-164: вызывающий `canReadDocument` присылает тип и состояние', () => {
  const files = callers();

  it('вызовы вообще находятся — обход не сломан', () => {
    // Страж, которому нечего проверять, зелен не потому, что всё хорошо.
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s берёт в выборку `type` и `status`', (rel) => {
    const source = readFileSync(join(SRC, rel), 'utf-8');
    // Ищем поля в любом `select`/`include` файла: гейт получает документ
    // ровно из той выборки, что рядом с вызовом.
    expect(source, `${rel}: в выборке документа нет \`type: true\``).toMatch(/\btype:\s*true\b/);
    expect(source, `${rel}: в выборке документа нет \`status: true\``).toMatch(
      /\bstatus:\s*true\b/
    );
  });
});
