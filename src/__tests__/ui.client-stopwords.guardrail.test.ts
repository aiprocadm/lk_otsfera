import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readSource } from './helpers/source';

/**
 * `У-266` — во внутренностях кабинетов клиента не должно быть наших слов.
 *
 * Заказчик, партнёр и слушатель не обязаны знать, что у заказа есть «внешний
 * идентификатор», что документы «выгружаются», а сообщения «синхронизируются».
 * Для них это шум, от которого экран перестаёт отвечать на вопрос «что здесь
 * делают» (§0.1 ТЗ, CLAUDE.md §15). Системной проверки на это не было — только
 * внимательность ревьюера, а она кончается на третьем экране подряд.
 *
 * **Как страж отличает текст от кода.** Берутся только строки, в которых есть
 * кириллица: идентификатор `companyId` кириллицы не содержит, а надпись
 * «Организация не найдена» — содержит. Это грубо, зато почти без ложных
 * срабатываний и не требует разбора JSX. Слово-нарушитель ищется ВНУТРИ такой
 * строки: `externalId` в русской фразе — это утечка, `externalId` как имя
 * свойства — обычный код.
 *
 * **Кабинеты сотрудников сюда не попадают намеренно.** Для менеджера «выгрузка
 * в 1С» и «внешний идентификатор» — рабочие термины из его собственного
 * словаря; запрет сделал бы его экраны менее понятными, а не более.
 */
const REPO_ROOT = join(__dirname, '..', '..');

/** Где живут экраны клиентских кабинетов. */
const CLIENT_DIRS = [
  'src/components/organization',
  'src/components/partner',
  'src/components/student',
  'src/app/organization',
  'src/app/partner',
  'src/app/student',
];

/**
 * Слова, которых пользователь-клиент видеть не должен. Каждое — из нашего
 * внутреннего словаря, а не из его.
 */
const STOPWORDS: Array<{ word: string; why: string }> = [
  // Внутренние идентификаторы: человеку они ничего не говорят, а показывают,
  // что мы протекли наружу структурой базы.
  { word: 'externalId', why: 'внутренний идентификатор' },
  { word: 'companyId', why: 'внутренний идентификатор' },
  { word: 'organizationId', why: 'внутренний идентификатор' },
  { word: 'partnerId', why: 'внутренний идентификатор' },
  { word: 'orderId', why: 'внутренний идентификатор' },
  { word: 'documentId', why: 'внутренний идентификатор' },
  { word: 'userId', why: 'внутренний идентификатор' },
  // Названия наших механизмов. Клиент не знает и не должен знать, через что
  // именно у нас ходят данные.
  { word: 'синхронизац', why: 'название нашего механизма' },
  { word: 'вебхук', why: 'название нашего механизма' },
  { word: 'webhook', why: 'название нашего механизма' },
  { word: 'payload', why: 'название нашего механизма' },
  { word: 'endpoint', why: 'название нашего механизма' },
  { word: 'Битрикс', why: 'чужая система, клиента она не касается' },
  { word: 'Bitrix', why: 'чужая система, клиента она не касается' },
  // Технические значения, протёкшие в текст.
  { word: 'undefined', why: 'протёкшее значение' },
  { word: 'NaN', why: 'протёкшее значение' },
  // Коды ошибок латиницей вместо русской строки из errors/messages.ts.
  { word: 'forbidden', why: 'код ошибки вместо русской строки' },
  { word: 'not_found', why: 'код ошибки вместо русской строки' },
  { word: 'invalid_request', why: 'код ошибки вместо русской строки' },
  { word: 'internal_error', why: 'код ошибки вместо русской строки' },
];

/**
 * Разрешённые исключения — **каждое с причиной**. Пустой список не самоцель:
 * бывают слова, которые для клиента законны.
 */
const ALLOWED: Array<{ file: string; text: string; why: string }> = [];

const CYRILLIC = /[а-яёА-ЯЁ]/;

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (full.endsWith('.tsx') || full.endsWith('.ts')) out.push(full);
  }
}

/**
 * Строковые литералы файла, в которых есть кириллица, — то есть почти наверняка
 * текст для человека. Комментарии сняты `readSource`: пояснение разработчика
 * пользователю не показывают, и краснеть из-за него страж не должен.
 */
function humanStrings(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(
    /'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"|`([^`]*)`/g
  )) {
    const text = m[1] ?? m[2] ?? m[3] ?? '';
    if (CYRILLIC.test(text)) out.push(text);
  }
  // Текст прямо в разметке: `<p>Организация не найдена</p>`.
  for (const m of src.matchAll(/>([^<>{}]+)</g)) {
    const text = (m[1] ?? '').trim();
    if (text.length > 0 && CYRILLIC.test(text)) out.push(text);
  }
  return out;
}

type Hit = { file: string; text: string; word: string; why: string };

function findHits(): Hit[] {
  const files: string[] = [];
  for (const dir of CLIENT_DIRS) walk(join(REPO_ROOT, dir), files);

  const hits: Hit[] = [];
  for (const file of files) {
    const rel = relative(REPO_ROOT, file);
    const src = readSource(file);
    for (const text of humanStrings(src)) {
      for (const { word, why } of STOPWORDS) {
        if (!text.includes(word)) continue;
        const excused = ALLOWED.some((a) => a.file === rel && a.text === text);
        if (excused) continue;
        hits.push({ file: rel, text: text.slice(0, 120), word, why });
      }
    }
  }
  return hits;
}

describe('тексты кабинетов клиента: без наших внутренних слов (У-266)', () => {
  it('страж вообще нашёл, что проверять (иначе проверка ничего не значит)', () => {
    const files: string[] = [];
    for (const dir of CLIENT_DIRS) walk(join(REPO_ROOT, dir), files);
    expect(
      files.length,
      'папки клиентских кабинетов не найдены — проверять нечего'
    ).toBeGreaterThan(50);
  });

  it('ни одного стоп-слова в тексте для заказчика, партнёра и слушателя', () => {
    const hits = findHits();
    const report = hits
      .map((h) => `  ${h.file}\n    «${h.text}»\n    → «${h.word}» — ${h.why}`)
      .join('\n');
    expect(
      hits,
      'В тексты клиентских кабинетов протекли наши внутренние слова:\n' +
        report +
        '\n\nПерепишите фразу человеческим языком. Если слово законно —\n' +
        'внесите строку в ALLOWED с причиной, а не расширяйте STOPWORDS.'
    ).toEqual([]);
  });

  it('у каждого исключения записана причина', () => {
    const noReason = ALLOWED.filter((a) => a.why.trim().length === 0).map((a) => a.file);
    expect(noReason, 'исключение без причины — это просто выключенная проверка').toEqual([]);
  });
});
