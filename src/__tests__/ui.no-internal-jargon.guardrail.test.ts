import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '@/lib/acceptance/screenRules';

/**
 * `У-175` (приёмка §0, выборка «глазами»): на экране «Реквизиты исполнителя»
 * подсказка формы заканчивалась словами «(этап 8)» — внутренним номером
 * этапа программы, который пользователю ничего не говорит. Такие слова
 * живут в комментариях и документах, но не в текстах интерфейса.
 *
 * Страж читает боевую разметку (`src/app/**`, `src/components/**`) без
 * комментариев и падает на «(этап N)» и на коды требований/решений/дефектов
 * (`У-12`, `Р-3`, `Д-40`, `ФТ-1.2`) в строках, которые видит человек.
 */
const ROOTS = ['src/app', 'src/components'];
// Код требования: буква, дефис, 1–3 цифры, и дальше не цифра и не дефис —
// иначе ловится номер документа вроде «С-2026-17» в подсказке поля.
const JARGON = /\(этап \d+|(?<![A-Za-zА-Яа-я\w])(?:У|Р|Т|Д|С)-\d{1,3}(?![\d-])|ФТ-\d/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('тексты интерфейса без внутреннего жаргона (§0, У-175)', () => {
  it('в разметке нет «(этап N)» и кодов У-/Р-/Д-/ФТ- вне комментариев', () => {
    const leaks: string[] = [];
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        const src = stripComments(readFileSync(file, 'utf8'));
        src.split('\n').forEach((line, i) => {
          if (JARGON.test(line)) leaks.push(`${relative('.', file)}:${i + 1}: ${line.trim()}`);
        });
      }
    }
    expect(leaks, 'внутренние слова в текстах интерфейса:\n' + leaks.join('\n')).toEqual([]);
  });
});
