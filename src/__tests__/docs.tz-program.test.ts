import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Страж протокола «продолжай по ТЗ» (CLAUDE.md §14, §16).
 *
 * Три файла обязаны говорить об одном и том же ТЗ: CLAUDE.md §14 (протокол),
 * docs/tz/STATUS.md (единственный источник правды о прогрессе) и
 * docs/tz/AUDIT.md (реестр сверки кода с ТЗ). Расходятся они молча: сессия
 * правит STATUS.md, забывает снимок в CLAUDE.md — и следующая сессия по фразе
 * «продолжай по ТЗ» начинает работать по закрытой программе.
 *
 * Тест ловит ровно этот класс расхождений, а также требование `У-N`, которое
 * есть в ТЗ, но не разложено ни по одному этапу (то есть будет молча забыто).
 */

// vitest запускается из корня репозитория.
const ROOT = process.cwd();
const TZ_DIR = path.join(ROOT, 'docs', 'tz');
const STATUS_PATH = path.join(TZ_DIR, 'STATUS.md');
const AUDIT_PATH = path.join(TZ_DIR, 'AUDIT.md');
const CLAUDE_PATH = path.join(ROOT, 'CLAUDE.md');
const ARCHITECTURE_PATH = path.join(ROOT, 'docs', 'ARCHITECTURE.md');

function read(file: string): string {
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** Имя файла действующего ТЗ, объявленное в шапке STATUS.md. */
function activeTzFile(): string {
  const match = read(STATUS_PATH).match(/\*\*Действующее ТЗ — \[[^\]]+\]\(([^)]+\.md)\)\*\*/);
  expect(
    match,
    'В шапке docs/tz/STATUS.md не найдено объявление вида ' +
      '"**Действующее ТЗ — [название](файл.md)**". Протокол «продолжай по ТЗ» ' +
      'читает эту строку первой — без неё следующая сессия не поймёт, по какому ТЗ работать.'
  ).not.toBeNull();
  return match![1]!;
}

/** Требования `У-N`, объявленные в §4 действующего ТЗ (строки вида `- **У-12.**`). */
function declaredRequirements(tzFile: string): Set<number> {
  const ids = new Set<number>();
  for (const m of read(path.join(TZ_DIR, tzFile)).matchAll(/^- \*\*У-(\d+)а?\.\*\*/gm)) {
    ids.add(Number(m[1]));
  }
  return ids;
}

/** Секция STATUS.md с таблицей этапов действующей программы. */
function stageTableSection(): string {
  const status = read(STATUS_PATH);
  const start = status.indexOf('## Этапы (программа');
  expect(
    start,
    'В docs/tz/STATUS.md нет секции "## Этапы (программа …)" — по ней определяется текущий этап.'
  ).toBeGreaterThan(-1);
  const end = status.indexOf('\n## ', start + 1);
  return end === -1 ? status.slice(start) : status.slice(start, end);
}

/**
 * Требования, разложенные по этапам. Берётся ТОЛЬКО третья колонка таблицы
 * («Требования»), а не весь текст секции: упоминание `У-34` в пояснительном
 * абзаце не должно маскировать этап, выпавший из таблицы.
 */
function stagedRequirements(): Set<number> {
  const covered = new Set<number>();
  for (const line of stageTableSection().split('\n')) {
    if (!line.startsWith('|')) continue;
    const cell = line.split('|')[3];
    if (!cell) continue;
    // Диапазон «У-20…У-32» и одиночное «У-4».
    for (const m of cell.matchAll(/У-(\d+)а?\s*(?:…|\.\.\.)\s*У-(\d+)а?/g)) {
      for (let n = Number(m[1]); n <= Number(m[2]); n += 1) covered.add(n);
    }
    for (const m of cell.matchAll(/У-(\d+)а?/g)) covered.add(Number(m[1]));
  }
  return covered;
}

/** Требования, попавшие в реестр сверки (в AUDIT.md id пишутся в бэктиках). */
function auditedRequirements(): Set<number> {
  const ids = new Set<number>();
  for (const m of read(AUDIT_PATH).matchAll(/`У-(\d+)а?`/g)) ids.add(Number(m[1]));
  return ids;
}

describe('протокол «продолжай по ТЗ» — согласованность CLAUDE.md, STATUS.md и ТЗ', () => {
  it('действующее ТЗ из STATUS.md существует на диске', () => {
    const file = activeTzFile();
    expect(
      existsSync(path.join(TZ_DIR, file)),
      `STATUS.md объявляет действующим ТЗ docs/tz/${file}, но такого файла нет.`
    ).toBe(true);
  });

  it('CLAUDE.md §14 называет то же действующее ТЗ, что и STATUS.md', () => {
    const file = activeTzFile();
    expect(
      read(CLAUDE_PATH).includes(`docs/tz/${file}`),
      `CLAUDE.md §14 не ссылается на docs/tz/${file}. Снимок в CLAUDE.md разошёлся с ` +
        'STATUS.md — следующая сессия по фразе «продолжай по ТЗ» начнёт работать не по тому ' +
        'документу. Обнови абзац «Действующее ТЗ — …» и блок «Состояние на <дата>».'
    ).toBe(true);
  });

  it('AUDIT.md ведётся по тому же действующему ТЗ', () => {
    const file = activeTzFile();
    expect(
      read(AUDIT_PATH).includes(file),
      `docs/tz/AUDIT.md не ссылается на действующее ТЗ docs/tz/${file}. Реестр сверки ` +
        'должен вестись по действующему документу (CLAUDE.md §16).'
    ).toBe(true);
  });

  it('docs/ARCHITECTURE.md называет то же действующее ТЗ', () => {
    const file = activeTzFile();
    expect(
      read(ARCHITECTURE_PATH).includes(file),
      `docs/ARCHITECTURE.md не ссылается на действующее ТЗ ${file}. Указатель на действующую ` +
        'программу живёт в трёх файлах (CLAUDE.md §14, docs/tz/STATUS.md, docs/ARCHITECTURE.md) ' +
        'и разъезжается именно при смене программы.'
    ).toBe(true);
  });

  it('STATUS.md сообщает текущий этап — точку входа протокола', () => {
    expect(
      /^## Текущий этап/m.test(read(STATUS_PATH)),
      'В docs/tz/STATUS.md нет заголовка "## Текущий этап…". Шаг 0 протокола (CLAUDE.md §14) ' +
        'читает именно его: там либо номер этапа и шаг, либо явное «программа закрыта».'
    ).toBe(true);
  });

  it('каждое требование действующего ТЗ разложено по этапам в STATUS.md', () => {
    const declared = declaredRequirements(activeTzFile());
    expect(
      declared.size,
      'В действующем ТЗ не найдено ни одного требования вида «- **У-N.**» — ' +
        'сломан разбор или подменён документ.'
    ).toBeGreaterThan(0);

    const staged = stagedRequirements();
    const missing = [...declared].filter((id) => !staged.has(id)).sort((a, b) => a - b);
    expect(
      missing,
      'Эти требования есть в ТЗ, но не попали ни в один этап таблицы STATUS.md, ' +
        `а значит будут молча забыты: ${missing.map((n) => `У-${n}`).join(', ')}`
    ).toEqual([]);
  });

  it('каждое требование действующего ТЗ заведено в реестре сверки AUDIT.md', () => {
    const declared = declaredRequirements(activeTzFile());
    const audited = auditedRequirements();
    const missing = [...declared].filter((id) => !audited.has(id)).sort((a, b) => a - b);
    expect(
      missing,
      'Эти требования отсутствуют в docs/tz/AUDIT.md — сверить код с ТЗ по ним будет нечем ' +
        `(CLAUDE.md §16): ${missing.map((n) => `У-${n}`).join(', ')}`
    ).toEqual([]);
  });
});
