import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource } from './helpers/source';

/**
 * Страж `У-336` (`Д-70`, ТЗ 28.10.2026): подзаголовок «Корректировок комиссии»
 * заканчивался служебной пометкой «(§9.5)» — ссылкой на параграф ТЗ, которую
 * видит пользователь. Подзаголовок отвечает на вопрос «что здесь делают»
 * простыми словами (CLAUDE.md §15); номера параграфов и требований — для
 * команды, им место в комментариях кода.
 *
 * Проверяем строковые подзаголовки (`subtitle="…"`, `subtitle={'…'}`) во всех
 * страницах и компонентах. Комментарии вырезает `readSource`.
 */

const ROOTS = ['src/app', 'src/components'].map((d) => join(process.cwd(), d));
const INTERNAL_REF = /§\s*\d|\b(У|Д|ФТ|Р|В|Т|С)-\d+/;
const SUBTITLE = /subtitle=(?:"([^"]*)"|\{\s*['`]([^'`]*)['`]\s*\})/g;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('подзаголовки экранов без ссылок на внутренние документы (У-336)', () => {
  it('ни один строковый подзаголовок не содержит «§N», «У-N», «ФТ-N» и подобного', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of ROOTS.flatMap(tsxFiles)) {
      for (const m of readSource(file).matchAll(SUBTITLE)) {
        seen += 1;
        const text = m[1] ?? m[2] ?? '';
        if (INTERNAL_REF.test(text)) {
          offenders.push(`${relative(process.cwd(), file)}: «${text}»`);
        }
      }
    }
    // Страж не проверяет пустоту: подзаголовков в проекте сотни.
    expect(seen).toBeGreaterThan(50);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
