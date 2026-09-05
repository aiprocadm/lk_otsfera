/**
 * Разбор реестра сверки `docs/tz/AUDIT.md` для drift-аудита (`У-176`, этап 9).
 *
 * Здесь — только чистые функции «текст → строки реестра → группа»: их гоняет
 * и режим `audit` скрипта `scripts/screen-acceptance.ts`, и юнит-тест на
 * фикстурах-строках. Диск и `git log` живут в скрипте.
 *
 * Строка реестра — `| У-N | что проверять | якорь | вердикт | сверено |`.
 * Разбирать её `split('|')` нельзя: в ячейках бывают `|` внутри бэктиков
 * (`'a' | 'b'`) и экранированные `\|`. Поэтому ячейки режутся с учётом
 * бэктиков, а вердикт и дата берутся с конца — тогда строка с лишней ячейкой
 * (якорь и факт разъехались по двум) разбирается так же, как ровная.
 *
 * Группы drift-аудита (план этапа 9, PR-3):
 * — `guard` — у требования есть тест-страж: сверка = зелёный прогон стража;
 * — `unchanged` — стража нет, но ни один якорь не менялся с последней сверки;
 * — `changed` — стража нет и якорь менялся: сверять руками по «Что проверять»;
 * — `manual` — якорей в коде нет вовсе: только руками;
 * — `fresh` — сверено в день прогона (сегодняшняя отметка уже стоит).
 */

export type AuditRow = {
  /** `У-1`, `У-34а`. */
  id: string;
  /** Номер строки в файле, с единицы. */
  line: number;
  /** Колонка «Что проверять». */
  what: string;
  /** Колонка «Вердикт», как записана. */
  verdict: string;
  /** Колонка «Сверено», как записана. */
  checked: string;
  /** Пути из ссылок строки относительно корня репозитория, без `#фрагмента`. */
  anchors: string[];
  /**
   * Кандидаты в стражи: имена вида `area.name[.guardrail]` из бэктиков и
   * якоря в `src/__tests__/`. Какие из них существуют — решает скрипт.
   */
  guardTokens: string[];
  /** Последняя дата колонки «Сверено» в виде `YYYY-MM-DD`; `null` — не сверялось. */
  lastChecked: string | null;
};

export type AuditGroup = 'guard' | 'unchanged' | 'changed' | 'manual' | 'fresh';

const ROW_RE = /^\| `(У-\d+а?)` \|/;

/** Режет строку таблицы на ячейки, не трогая `|` внутри бэктиков и `\|`. */
export function splitCells(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      cur += '\\|';
      i += 1;
      continue;
    }
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // Строка начинается и кончается `|` — по краям пустые ячейки.
  if (cells.length > 0 && cells[0]?.trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/** Самая поздняя дата `DD.MM.YYYY` в ячейке → `YYYY-MM-DD`; нет дат — `null`. */
export function lastDateOf(cell: string): string | null {
  let best: string | null = null;
  for (const m of cell.matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (best === null || iso > best) best = iso;
  }
  return best;
}

/**
 * Ссылки строки → пути от корня репозитория. Реестр лежит в `docs/tz/`,
 * поэтому `../../x` → `x`, `../x` → `docs/x`, `x.md` → `docs/tz/x.md`.
 * Внешние ссылки и ссылки-якоря внутри файла (`#…`) — не пути.
 */
export function anchorsOf(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = (m[1] ?? '').split('#')[0] ?? '';
    if (!raw || /^[a-z]+:/i.test(raw)) continue;
    let path: string;
    if (raw.startsWith('../../')) path = raw.slice(6);
    else if (raw.startsWith('../')) path = `docs/${raw.slice(3)}`;
    else path = `docs/tz/${raw}`;
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/** Имена вида `security.role-access-matrix.guardrail` из бэктиков + якоря в `src/__tests__/`. */
export function guardTokensOf(line: string, anchors: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/`([a-z0-9-]+(?:\.[a-z0-9-]+)+)`/g)) {
    const token = m[1] ?? '';
    if (token && !out.includes(token)) out.push(token);
  }
  for (const a of anchors) {
    // Помощник вроде `src/__tests__/helpers/x.ts` — не тест: vitest его не запустит.
    if (a.startsWith('src/__tests__/') && /\.test\.tsx?$/.test(a) && !out.includes(a)) out.push(a);
  }
  return out;
}

export function parseAuditRows(md: string): AuditRow[] {
  const rows: AuditRow[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const cells = splitCells(line);
    // Минимум: номер, что проверять, вердикт, сверено. Между «что» и
    // вердиктом — якорь (иногда две ячейки).
    if (cells.length < 4) continue;
    const checked = cells[cells.length - 1] ?? '';
    const verdict = cells[cells.length - 2] ?? '';
    const anchors = anchorsOf(line);
    rows.push({
      id: m[1] ?? '',
      line: i + 1,
      what: cells[1] ?? '',
      verdict,
      checked,
      anchors,
      guardTokens: guardTokensOf(line, anchors),
      lastChecked: lastDateOf(checked),
    });
  }
  return rows;
}

export type ClassifyInput = {
  /** Дата прогона, `YYYY-MM-DD`. */
  today: string;
  /** Стражи строки, которые реально существуют (после разрешения скриптом). */
  guards: readonly string[];
  /** Якоря строки, у которых есть коммиты после последней сверки. */
  changed: readonly string[];
};

export function classifyRow(row: AuditRow, input: ClassifyInput): AuditGroup {
  if (row.lastChecked === input.today) return 'fresh';
  if (input.guards.length > 0) return 'guard';
  if (row.anchors.length === 0) return 'manual';
  // Ни разу не сверялось — история якоря целиком «после последней сверки».
  if (row.lastChecked === null) return 'changed';
  return input.changed.length > 0 ? 'changed' : 'unchanged';
}

/** `2026-09-05` → `05.09.2026` — так даты записаны в колонке «Сверено». */
export function ruDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d ?? ''}.${m ?? ''}.${y ?? ''}`;
}

/**
 * Дописывает отметку в колонку «Сверено» указанных строк: `… · <отметка> |`.
 * История колонки сохраняется — прежние даты остаются перед новой. Строки,
 * которых нет в `marks`, не трогаются; пустая колонка (`—`) заменяется.
 */
export function markChecked(md: string, marks: ReadonlyMap<string, string>): string {
  return md
    .split('\n')
    .map((line) => {
      const m = ROW_RE.exec(line);
      if (!m) return line;
      const note = marks.get(m[1] ?? '');
      if (note === undefined) return line;
      // Последняя ячейка — даты и слова, `|` внутри неё не бывает.
      const tail = /^(.*\|)([^|]*)\|\s*$/.exec(line);
      if (!tail) return line;
      const prev = (tail[2] ?? '').trim();
      const joined = prev === '' || prev === '—' ? note : `${prev} · ${note}`;
      return `${tail[1] ?? ''} ${joined} |`;
    })
    .join('\n');
}
