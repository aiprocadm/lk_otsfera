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
const MAINTENANCE_PATH = path.join(TZ_DIR, 'MAINTENANCE.md');

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

  /**
   * Якорь — это адрес, по которому проверяют требование. Если файл переехал
   * или его удалили, ссылка молча превращается в тупик: следующий
   * проверяющий открывает её, не находит кода и либо решает, что требование
   * не выполнено, либо проверяет наугад.
   *
   * Так и было: `У-16` полтора месяца ссылался на два `bottom-tab-bar.tsx`,
   * удалённых при объединении в `shell/mobile-nav.tsx` — то есть ссылка
   * ломалась ровно тогда, когда требование выполняли. Найдено сверкой
   * 19.08.2026.
   */
  /**
   * Сводка вверху реестра — единственное, что читают, когда спрашивают «всё
   * ли сделано». Если её цифры разъезжаются с таблицами, врёт именно она.
   *
   * Так и было: при закрытии программы 13.08.2026 сводка сообщала «78 × ✅,
   * 0 × ⏳», хотя строка `У-36` всё это время стояла с `⏳` (поле
   * `EnrollmentRequest.directionId` помечено устаревшим, но не удалено).
   * Ошибка подсчёта прятала незакрытое требование: программа выглядела
   * выполненной целиком. Найдено сверкой 19.08.2026.
   */
  it('цифры сводки сходятся с вердиктами в таблицах', () => {
    const audit = readFileSync(AUDIT_PATH, 'utf8');

    const actual = { ok: 0, planned: 0, drift: 0 };
    for (const line of audit.split('\n')) {
      if (!/^\| `У-\d+а?` \|/.test(line)) continue;
      const cells = line.split('|');
      // Строка: | У-N | что проверять | якорь | вердикт | дата |
      // split даёт пустые ячейки по краям, поэтому вердикт — третий с конца.
      const verdict = cells[cells.length - 3] ?? '';
      if (verdict.includes('✅')) actual.ok += 1;
      else if (verdict.includes('⏳')) actual.planned += 1;
      else if (verdict.includes('❌')) actual.drift += 1;
    }

    const claimed = (label: string): number => {
      const row = new RegExp(`\\| \`${label}\`[^|]*\\| \\*{0,2}(\\d+)`).exec(audit);
      expect(row, `в сводке AUDIT.md нет строки «${label}»`).not.toBeNull();
      return Number(row?.[1] ?? -1);
    };

    expect(claimed('✅'), 'сводка завышает или занижает число ✅').toBe(actual.ok);
    expect(
      claimed('⏳'),
      'сводка расходится с таблицами по ⏳ — так незакрытое требование становится невидимым'
    ).toBe(actual.planned);
    expect(claimed('❌'), 'сводка расходится с таблицами по ❌').toBe(actual.drift);
  });

  it('все якоря реестра ведут на существующие файлы', () => {
    const audit = readFileSync(AUDIT_PATH, 'utf8');
    const dead: string[] = [];

    for (const line of audit.split('\n')) {
      const req = /^\| `(У-\d+а?)` \|/.exec(line);
      if (!req) continue;
      for (const m of line.matchAll(/\]\(\.\.\/\.\.\/([^)]+)\)/g)) {
        const target = (m[1] ?? '').split('#')[0] ?? '';
        if (!target) continue;
        if (!existsSync(path.join(ROOT, target))) {
          dead.push(`${req[1]} → ${target}`);
        }
      }
    }

    expect(
      dead,
      'Битые якоря в docs/tz/AUDIT.md — проверять требование будет нечем (CLAUDE.md §16):\n' +
        dead.join('\n')
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

/**
 * Режим сопровождения (`У-80`…`У-82` ТЗ 21.08.2026, CLAUDE.md §14).
 *
 * Когда все этапы действующего ТЗ стоят в `✅`, фраза «продолжай по ТЗ» ведёт
 * не к ответу «работы нет», а к реестру проверок `docs/tz/MAINTENANCE.md`:
 * агент берёт проверку с самой старой датой прогона и выполняет её. Если у
 * проверки нет колонки «Последний прогон» — выбирать не по чему, и режим
 * молча вырождается обратно в «работы нет». Поэтому структура реестра
 * охраняется здесь, а не только описанием в CLAUDE.md.
 */
describe('режим сопровождения — реестр проверок MAINTENANCE.md', () => {
  const CHECK_IDS = Array.from({ length: 10 }, (_, i) => `С-${i + 1}`);

  it('реестр существует, а CLAUDE.md §14 описывает режим сопровождения', () => {
    expect(
      existsSync(MAINTENANCE_PATH),
      'Нет docs/tz/MAINTENANCE.md — по фразе «продолжай по ТЗ» в закрытой программе агенту ' +
        'нечего выбирать (CLAUDE.md §14, блок «Режим сопровождения»).'
    ).toBe(true);
    expect(
      /^### Режим сопровождения/m.test(read(CLAUDE_PATH)),
      'В CLAUDE.md §14 нет блока «### Режим сопровождения…» — протокол на случай закрытой ' +
        'программы потерян, и следующая сессия снова ответит «работы нет».'
    ).toBe(true);
  });

  it('у каждой проверки С-1…С-10 есть строка с процедурой и колонкой «Последний прогон»', () => {
    const lines = read(MAINTENANCE_PATH).split('\n');
    const header = lines.find((l) => /^\| № \| Проверка \|/.test(l));
    expect(
      header,
      'В MAINTENANCE.md нет таблицы проверок с шапкой «| № | Проверка | … |».'
    ).toBeDefined();
    const columns = (header ?? '')
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    const runIdx = columns.indexOf('Последний прогон');
    expect(
      runIdx,
      'В таблице проверок нет колонки «Последний прогон» — без неё нельзя выбрать самую ' +
        'старую проверку (шаг 2 режима сопровождения).'
    ).toBeGreaterThan(-1);

    const missing: string[] = [];
    const emptyRun: string[] = [];
    for (const id of CHECK_IDS) {
      const row = lines.find((l) => l.startsWith(`| ${id} |`));
      if (!row) {
        missing.push(id);
        continue;
      }
      const cells = row
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      if (!cells[runIdx]) emptyRun.push(id);
    }
    expect(missing, `В реестре нет проверок: ${missing.join(', ')}`).toEqual([]);
    expect(
      emptyRun,
      'У этих проверок пуста колонка «Последний прогон» (допустимо «не выполнялась», но не ' +
        `пустота): ${emptyRun.join(', ')}`
    ).toEqual([]);
  });

  it('все относительные ссылки реестра ведут на существующие файлы', () => {
    const dead: string[] = [];
    for (const m of read(MAINTENANCE_PATH).matchAll(
      /\]\(((?:\.\.\/)*[^)#:]+\.(?:md|ts|tsx))(?:#[^)]*)?\)/g
    )) {
      const target = m[1] ?? '';
      if (!target) continue;
      if (!existsSync(path.resolve(TZ_DIR, target))) dead.push(target);
    }
    expect(dead, 'Битые ссылки в docs/tz/MAINTENANCE.md:\n' + dead.join('\n')).toEqual([]);
  });
});
