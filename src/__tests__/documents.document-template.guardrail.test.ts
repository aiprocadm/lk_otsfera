/**
 * Страж (`У-160`, `У-162`): готовых формулировок в ВЁРСТКЕ не остаётся —
 * ни в договоре, ни в коммерческом предложении.
 *
 * Зачем страж, а не доверие: пока текст живёт в файле печати, его правят
 * программисты, а не юристы компании, — и раздел «Шаблоны документов» тихо
 * перестаёт быть источником правды. Один возвращённый в вёрстку литерал
 * ломает всё требование, а обычные тесты печати этого не заметят: они
 * проверяют, что PDF собрался, а не что в нём написано.
 *
 * **Страж односторонний, и это его слабое место.** Он проверял ровно один
 * файл печати. Появился второй тип с текстами (КП, `У-162`) — и для него
 * страж молчал бы, оставаясь при этом зелёным. Поэтому проверка разведена по
 * файлам: каждый слот проверяется в ТОМ файле, где он печатается, а список
 * файлов выводится из самого реестра.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCUMENT_TEMPLATE_SLOTS } from '@/lib/documents/documentTemplate';

const CONTRACT_PDF = join(process.cwd(), 'src/lib/services/documents/contractDocumentPdf.ts');
const PROPOSAL_PDF = join(process.cwd(), 'src/lib/services/documents/proposalDocumentPdf.ts');
const GENERATOR = join(process.cwd(), 'src/lib/services/documents/generate.ts');

/** Где печатается слот. Новый тип документа обязан появиться и здесь. */
const PDF_BY_DOC_TYPE: Record<string, string> = {
  contract: CONTRACT_PDF,
  extra_agreement: CONTRACT_PDF,
  commercial_proposal: PROPOSAL_PDF,
};

/** Первые слова формулировки — по ним и ищем её в вёрстке. */
function head(text: string): string {
  return text
    .replace(/\{\{[^}]+\}\}/g, '')
    .trim()
    .slice(0, 40);
}

describe('вёрстка не хранит готовых текстов — ни в одном файле печати', () => {
  it('каждый тип документа с текстами знает свой файл печати', () => {
    // Смок против дыры в самом страже: новый тип, забытый в карте, оставил бы
    // свои слова непроверенными, а страж — зелёным.
    const types = new Set(DOCUMENT_TEMPLATE_SLOTS.flatMap((s) => s.docTypes));
    for (const type of types) {
      expect(PDF_BY_DOC_TYPE[type], `тип «${type}» не заведён в карте файлов печати`).toBeTruthy();
    }
  });

  it.each(
    DOCUMENT_TEMPLATE_SLOTS.filter((s) => s.defaultText).map(
      (s) => [s.key, s.defaultText, s.docTypes[0] as string] as const
    )
  )('текста слота «%s» в его файле печати нет', (_key, defaultText, docType) => {
    // Сравниваем по первым словам: полное совпадение сломалось бы от переноса
    // строки в исходнике, а начало формулировки узнаваемо и уникально.
    const source = readFileSync(PDF_BY_DOC_TYPE[docType]!, 'utf8');
    expect(source).not.toContain(head(defaultText));
  });

  it('ни один готовый текст не просочился в ЧУЖОЙ файл печати', () => {
    // Проверка от обратного: слот КП, скопированный в вёрстку договора,
    // прошёл бы предыдущую проверку — она смотрит только «свой» файл.
    for (const file of new Set(Object.values(PDF_BY_DOC_TYPE))) {
      const source = readFileSync(file, 'utf8');
      for (const slot of DOCUMENT_TEMPLATE_SLOTS) {
        if (!slot.defaultText) continue;
        expect(source, `${slot.key} → ${file}`).not.toContain(head(slot.defaultText));
      }
    }
  });
});

describe('вёрстка договора', () => {
  const source = readFileSync(CONTRACT_PDF, 'utf8');

  it('номер пункта печатает вёрстка, а не текст', () => {
    // Шаблон печатается как «<номер>. <текст>»: пропади это, номера исчезли бы
    // из документа целиком, и ни один тест печати не покраснел бы.
    expect(source).toMatch(/\$\{c\.clause\}\.\s\$\{c\.text\}/);
  });

  it('каждый номер раздела из реестра печатается: забытый абзац невозможен', () => {
    // Раньше разделы печатались списками ключей, и новый слот в реестре молча
    // не попадал в документ. Теперь абзац находит свой раздел по номеру
    // пункта — проверяем, что для каждого номера в вёрстке есть вызов.
    // Только нумерованные слоты: у КП номеров пунктов нет вовсе, и пустой
    // раздел «''» страж искал бы в вёрстке договора вечно.
    const sections = new Set(
      DOCUMENT_TEMPLATE_SLOTS.filter(
        (s) => s.clause && s.docTypes.some((t) => t !== 'commercial_proposal')
      ).map((s) => s.clause.split('.')[0])
    );
    expect(sections.size, 'разделов не нашлось — обход стража сломан').toBeGreaterThan(0);
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

describe('вёрстка коммерческого предложения (`У-162`)', () => {
  const source = readFileSync(PROPOSAL_PDF, 'utf8');

  it('каждый абзац КП из реестра реально печатается', () => {
    // Симметрия договорной проверке. Там абзац находит раздел по номеру
    // пункта; у КП номеров нет, поэтому абзацы печатаются по ключу — и
    // забытый ключ означал бы письмо без единого слова текста, собранное без
    // единой ошибки.
    const keys = DOCUMENT_TEMPLATE_SLOTS.filter((s) =>
      s.docTypes.includes('commercial_proposal')
    ).map((s) => s.key);
    expect(keys.length, 'слотов КП не нашлось — обход стража сломан').toBeGreaterThan(0);
    for (const key of keys) {
      expect(source, `абзац «${key}» не печатается`).toContain(
        `clauseByKey(data.clauses, '${key}')`
      );
    }
  });

  it('срок действия печатается отдельной строкой, а не только внутри текста', () => {
    // Менеджер вправе переписать «Условия» своими словами и выкинуть оттуда
    // дату. Предложение без срока — прайс-лист: строка со сроком печатается
    // вёрсткой независимо от текста.
    expect(source).toContain('data.validUntil');
    // Подпись к значению, а не редактируемая фраза: совпади она с текстом
    // слота, страж чистоты вёрстки перестал бы их различать.
    expect(source).toContain('Срок действия: до');
  });
});

describe('генератор читает шаблон и записывает редакцию', () => {
  const source = readFileSync(GENERATOR, 'utf8');

  it('абзацы собирает ТОЛЬКО общий рендер — предпросмотру и выпуску негде разойтись', () => {
    // Раньше здесь стояло «вызов ровно один». Проверка держалась на том, что
    // тип с текстами один; с приходом КП (`У-162`) веток стало две, и счётчик
    // покраснел, хотя инвариант цел. Инвариант на самом деле такой: сборкой
    // абзацев занимается общий `renderDocument`, а предпросмотр и выпуск оба
    // зовут ЕГО. Счёт вызовов был лишь приметой этого.
    const cut = source.indexOf('export async function previewOrderDocument');
    expect(cut, 'предпросмотр не найден — страж потерял ориентир').toBeGreaterThan(0);
    const beforePublicApi = source.slice(0, cut);
    const publicApi = source.slice(cut);

    // Все вызовы сборки — до публичных функций, то есть внутри `renderDocument`.
    expect(beforePublicApi.match(/resolveDocumentClauses\(/g)?.length ?? 0).toBeGreaterThan(0);
    expect(
      publicApi.match(/resolveDocumentClauses\(/g),
      'предпросмотр или выпуск собирает абзацы САМ — тексты могут разойтись'
    ).toBeNull();

    // …и оба публичных пути идут через общий рендер.
    expect(publicApi.match(/renderDocument\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('редакция шаблона доезжает до записи документа', () => {
    expect(source).toContain('templateVersion: rendered.templateVersion');
  });
});
