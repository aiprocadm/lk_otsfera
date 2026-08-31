/**
 * Страж (`У-160`): юридических формулировок в ВЁРСТКЕ договора не остаётся.
 *
 * Зачем страж, а не доверие: пока текст живёт в файле печати, его правят
 * программисты, а не юристы компании, — и раздел «Шаблоны документов» тихо
 * перестаёт быть источником правды. Один возвращённый в вёрстку литерал
 * ломает всё требование, а обычные тесты печати этого не заметят: они
 * проверяют, что PDF собрался, а не что в нём написано.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTRACT_TEMPLATE_SLOTS } from '@/lib/documents/contractTemplate';

const PDF_SOURCE = join(process.cwd(), 'src/lib/services/documents/contractDocumentPdf.ts');
const GENERATOR = join(process.cwd(), 'src/lib/services/documents/generate.ts');

describe('вёрстка договора не хранит юридических текстов', () => {
  const source = readFileSync(PDF_SOURCE, 'utf8');

  it.each(
    CONTRACT_TEMPLATE_SLOTS.filter((s) => s.defaultText).map((s) => [s.key, s.defaultText] as const)
  )('текста слота «%s» в файле печати нет', (_key, defaultText) => {
    // Сравниваем по первым словам: полное совпадение сломалось бы от переноса
    // строки в исходнике, а начало формулировки узнаваемо и уникально.
    const head = defaultText
      .replace(/\{\{[^}]+\}\}/g, '')
      .trim()
      .slice(0, 40);
    expect(source).not.toContain(head);
  });

  it('номер пункта печатает вёрстка, а не текст', () => {
    // Шаблон печатается как «<номер>. <текст>»: пропади это, номера исчезли бы
    // из документа целиком, и ни один тест печати не покраснел бы.
    expect(source).toMatch(/\$\{c\.clause\}\.\s\$\{c\.text\}/);
  });

  it('каждый номер раздела из реестра печатается: забытый абзац невозможен', () => {
    // Раньше разделы печатались списками ключей, и новый слот в реестре молча
    // не попадал в документ. Теперь абзац находит свой раздел по номеру
    // пункта — проверяем, что для каждого номера в вёрстке есть вызов.
    const sections = new Set(CONTRACT_TEMPLATE_SLOTS.map((s) => s.clause.split('.')[0]));
    for (const section of sections) {
      expect(source).toContain(`clauseParagraphs(data.clauses, '${section}')`);
    }
  });

  it('вёрстка не знает полей формы выпуска — она получает готовые абзацы', () => {
    for (const dead of [
      'data.paymentTerms',
      'data.changeText',
      'data.validUntil',
      'data.subject',
    ]) {
      expect(source).not.toContain(dead);
    }
  });
});

describe('генератор читает шаблон и записывает редакцию', () => {
  const source = readFileSync(GENERATOR, 'utf8');

  it('абзацы собираются одним вызовом — предпросмотру и выпуску негде разойтись', () => {
    expect(source.match(/resolveContractClauses\(/g)).toHaveLength(1);
  });

  it('редакция шаблона доезжает до записи документа', () => {
    expect(source).toContain('templateVersion: rendered.templateVersion');
  });
});
