/**
 * Правила приёмки §0 по исходникам экрана (`У-175`, этап 9).
 *
 * Здесь — только чистые функции «текст → признаки»: их гоняет и скрипт
 * `scripts/screen-acceptance.ts`, и юнит-тест на фикстурах-строках. Чтение
 * файлов, `git diff` и разбор импортов по диску живут в скрипте — иначе
 * функцию не проверить без диска, а правило с диском не проверить мутацией.
 *
 * Три вопроса §15 CLAUDE.md переводятся в три признака:
 * — «где я» — есть `<PageHeader title=…>` (или `<h1>`) с русским названием;
 * — «что здесь» — у шапки есть `subtitle`; `subtitle={null}` — законная
 *   дверь карточки сущности (`У-73`), она считается отдельно;
 * — «что дальше» — на экране есть кнопка, форма или пустое состояние с
 *   кнопкой (`EmptyState`, `У-74`).
 *
 * Проверяется **цепочка** «страница + её компоненты», а не один `page.tsx`:
 * урок `У-77` — заголовок и кнопки часто живут в клиентском компоненте.
 */

export type ScreenCabinet =
  'admin' | 'leader' | 'manager' | 'partner' | 'organization' | 'student' | 'other';

const CABINET_LABELS: Record<ScreenCabinet, string> = {
  admin: 'Администратор',
  leader: 'Руководитель',
  manager: 'Менеджер',
  partner: 'Партнёр',
  organization: 'Заказчик',
  student: 'Слушатель',
  other: 'Вне кабинетов',
};

export type ScreenSignals = {
  /** `ru` — русское название; `dynamic` — имя объекта из данных; `latin` — заглушка; `none` — шапки нет. */
  title: 'ru' | 'dynamic' | 'latin' | 'none';
  /** `yes` — подзаголовок есть; `card` — снят осознанно (`subtitle={null}`); `none` — нет. */
  subtitle: 'yes' | 'card' | 'none';
  /** Есть кнопка, форма или ссылка-кнопка. */
  action: boolean;
  /** Есть пустое состояние с объяснением (`EmptyState`). */
  emptyState: boolean;
  /** Шапки нет, зато есть редирект: это шлюз старого адреса, а не экран. */
  gateway: boolean;
};

export type ScreenRow = {
  file: string;
  route: string;
  cabinet: ScreenCabinet;
  /** `A` — экран новый относительно базы, `M` — изменён. */
  status: 'A' | 'M';
  signals: ScreenSignals;
};

export type CabinetSummary = {
  cabinet: ScreenCabinet;
  screens: number;
  gateways: number;
  whereAmI: number;
  whatHere: number;
  whatNext: number;
};

/** Экран с пробелом: какой из трёх вопросов остался без ответа. */
export type ScreenGap = { route: string; file: string; missing: string[] };

const CABINETS: readonly ScreenCabinet[] = [
  'admin',
  'leader',
  'manager',
  'partner',
  'organization',
  'student',
];

/** Сегменты маршрута без `page.tsx`, `src/app` и групп `(auth)`. */
function routeSegments(file: string): string[] {
  const parts = file.replace(/\\/g, '/').split('/');
  const app = parts.indexOf('app');
  return parts.slice(app + 1).filter((s) => s !== 'page.tsx' && !s.startsWith('('));
}

/** `src/app/admin/organizations/[id]/page.tsx` → `admin`. */
export function cabinetOf(file: string): ScreenCabinet {
  const first = routeSegments(file)[0];
  return CABINETS.find((c) => c === first) ?? 'other';
}

/** `src/app/admin/organizations/[id]/page.tsx` → `/admin/organizations/[id]`. */
export function routeOf(file: string): string {
  return `/${routeSegments(file).join('/')}`;
}

/** Где кончается `/* … *\/`, начатый до `from`; незакрытый — до конца текста. */
function blockEnd(src: string, from: number): number {
  const close = src.indexOf('*/', from);
  return close === -1 ? src.length : close + 2;
}

/** Где кончается `// …`: перед переводом строки (`\r\n` — перед `\r`). */
function lineEnd(src: string, from: number): number {
  const nl = src.indexOf('\n', from);
  const end = nl === -1 ? src.length : nl;
  return src.charAt(end - 1) === '\r' ? end - 1 : end;
}

/** `{/* … *\/}` — комментарий в разметке JSX: снимается вместе со скобками; `-1` — не он. */
function jsxCommentEnd(src: string, open: number): number {
  if (!src.startsWith('/*', open + 1)) return -1;
  const end = blockEnd(src, open + 3);
  return src.charAt(end) === '}' ? end + 1 : -1;
}

/**
 * Где кончается строка `'…'` или `"…"`, открытая на `start`. Незакрытая
 * строка обрывается на переводе строки — как у компилятора: так ошибка в
 * разборе (апостроф в тексте разметки) портит одну строку, а не весь файл.
 */
function stringEnd(src: string, start: number): number {
  const quote = src.charAt(start);
  for (let k = start + 1; k < src.length; k += 1) {
    const ch = src.charAt(k);
    if (ch === '\\') k += 1;
    else if (ch === quote) return k + 1;
    else if (ch === '\n') return k;
  }
  return src.length;
}

/** Где кончается регулярное выражение `/…/флаги`: `/` внутри `[…]` его не закрывает. */
function regexEnd(src: string, start: number): number {
  let inClass = false;
  for (let k = start + 1; k < src.length; k += 1) {
    const ch = src.charAt(k);
    if (ch === '\\') k += 1;
    else if (ch === '\n') return k;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      let end = k + 1;
      while (/[a-z]/i.test(src.charAt(end))) end += 1;
      return end;
    }
  }
  return src.length;
}

/** После этих знаков `/` открывает регулярное выражение, а не делит. */
const REGEX_AFTER = '(,=:[!&|?{};>';
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
  'instanceof',
]);

/**
 * `/` на этом месте — начало регулярки? Решает последний значащий символ
 * кода перед ним (`at`, `-1` — начало файла): после имени, числа, `)` и `]`
 * это деление, после `=`, `(`, `return` и им подобных — регулярка.
 */
function regexAllowedAfter(src: string, at: number): boolean {
  if (at < 0) return true;
  if (REGEX_AFTER.includes(src.charAt(at))) return true;
  let from = at;
  while (/[\w$]/.test(src.charAt(from))) from -= 1;
  return REGEX_KEYWORDS.has(src.slice(from + 1, at + 1));
}

/** Символы, на которых разбор кода останавливается; остальное — просто код. */
const CODE_STOP = /[/'"`{}]/g;

/**
 * Код без комментариев: в них `<h1>` и «кнопка» упоминаются как объяснение,
 * а стражам по исходнику (`src/__tests__/helpers/source.ts`) закомментированный
 * вызов нельзя считать живым.
 *
 * **Прогон сопровождения №37: разбор по символам вместо трёх регулярок.**
 * Прежняя регулярка `//.*` не знала о строках и считала `//` внутри `'https://…'`
 * началом комментария: всё, что стояло на строке после адреса, исчезало для
 * каждого стража, читающего исходник через этот помощник. Дата без пояса
 * после ссылки на той же строке проходила страж `dates.moscow-display`
 * зелёной. Теперь строки `'…'` и `"…"`, шаблоны `` `…${…}…` `` (с любой
 * вложенностью подстановок) и регулярки `/…/` проходятся целиком, а
 * комментарием считается только то, что им является.
 *
 * Известные пределы — разбор не компилятор:
 * — текст разметки JSX между тегами (`<p>было // стало</p>`) не отличить от
 *   кода без разбора самой разметки, поэтому `//` в нём снимается до конца
 *   строки, как раньше. Исключение — `://` (адрес в тексте разметки,
 *   `<p>см. https://…</p>`): двоеточие вплотную перед `//` в коде не
 *   встречается (форматтер ставит пробел);
 * — регулярка отличается от деления по знаку перед `/`: после `)`, `]`, `}`
 *   и имени это деление. `if (x) /re/.test(s)` прочитается неверно, но такой
 *   записи в проекте нет, а ошибка ограничена одной строкой.
 *
 * `keepLayout` — не вырезать комментарий, а заменить пробелами (переводы
 * строк остаются): позиции и номера строк совпадают с исходным файлом.
 */
export function stripComments(src: string, keepLayout = false): string {
  const parts: string[] = [];
  let flushed = 0;
  let i = 0;
  // Последний значащий символ кода: по нему `/` решает, регулярка ли он.
  let lastSig = -1;

  const cut = (end: number): void => {
    parts.push(src.slice(flushed, i));
    if (keepLayout) parts.push(src.slice(i, end).replace(/[^\r\n]/g, ' '));
    i = end;
    flushed = end;
  };
  const pass = (end: number): void => {
    lastSig = end - 1;
    i = end;
  };

  // Шаблон `…`: текст идёт как есть, а `${…}` — снова код со своими
  // комментариями, строками и вложенными шаблонами.
  const template = (): void => {
    i += 1;
    while (i < src.length) {
      const ch = src.charAt(i);
      if (ch === '\\') i += 2;
      else if (ch === '`') {
        pass(i + 1);
        return;
      } else if (ch === '$' && src.charAt(i + 1) === '{') {
        pass(i + 2);
        code(true);
        i += 1;
      } else i += 1;
    }
  };

  // `inExpr` — разбор внутри `${…}`: закрывающая `}` своего уровня возвращает
  // управление шаблону.
  const code = (inExpr: boolean): void => {
    let depth = 0;
    while (i < src.length) {
      // `lastIndex` ставится перед каждым поиском, поэтому один общий объект
      // регулярки годится и для вложенных уровней разбора.
      CODE_STOP.lastIndex = i;
      const m = CODE_STOP.exec(src);
      if (!m) {
        i = src.length;
        return;
      }
      for (let k = m.index - 1; k >= i; k -= 1) {
        if (!/\s/.test(src.charAt(k))) {
          lastSig = k;
          break;
        }
      }
      i = m.index;
      const ch = m[0];
      const next = src.charAt(i + 1);
      if (ch === '/' && next === '/' && src.charAt(i - 1) !== ':') cut(lineEnd(src, i));
      else if (ch === '/' && next === '*') cut(blockEnd(src, i + 2));
      else if (ch === '/') pass(regexAllowedAfter(src, lastSig) ? regexEnd(src, i) : i + 1);
      else if (ch === "'" || ch === '"') pass(stringEnd(src, i));
      else if (ch === '`') template();
      else if (ch === '{') {
        const jsx = jsxCommentEnd(src, i);
        if (jsx === -1) {
          depth += 1;
          pass(i + 1);
        } else cut(jsx);
      } else if (inExpr && depth === 0) return;
      else {
        depth -= 1;
        pass(i + 1);
      }
    }
  };

  code(false);
  parts.push(src.slice(flushed));
  return parts.join('');
}

/**
 * Импорты, из которых строится цепочка экрана: `@/components/**` и
 * относительные (`./editor`, `../ui/x`) — компоненты экрана часто лежат рядом
 * и импортируются по относительному пути. Разрешает пути скрипт.
 */
export function componentImports(src: string): string[] {
  const out: string[] = [];
  for (const m of stripComments(src).matchAll(/from\s+'(@\/components\/[^']+|\.\.?\/[^']+)'/g)) {
    const spec = m[1] as string;
    if (!out.includes(spec)) out.push(spec);
  }
  return out;
}

const CYRILLIC = /[А-Яа-яЁё]/;

/** Окно атрибутов после каждого `<PageHeader`: тег редко длиннее. */
function headerWindows(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<PageHeader\b/g)) {
    out.push(src.slice(m.index, m.index + 800));
  }
  return out;
}

const TITLE_ATTR = /(?<![A-Za-z])title=(?:"([^"]*)"|\{\s*(?:'([^']*)'|`([^`]*)`)\s*\}|\{)/;

function classifyTitle(windows: string[], src: string): ScreenSignals['title'] {
  for (const w of windows) {
    const m = TITLE_ATTR.exec(w);
    if (!m) continue;
    const literal = m[1] ?? m[2] ?? m[3];
    if (literal === undefined) return 'dynamic';
    return CYRILLIC.test(literal) ? 'ru' : 'latin';
  }
  // Заголовок руками — сторож `У-120` такого не пропускает, но скрипт приёмки
  // обязан видеть и то, что сторож запретил бы.
  const h1 = /<h1[\s>][\s\S]*?<\/h1>/.exec(src);
  if (!h1) return 'none';
  if (CYRILLIC.test(h1[0])) return 'ru';
  return h1[0].includes('{') ? 'dynamic' : 'latin';
}

function classifySubtitle(windows: string[]): ScreenSignals['subtitle'] {
  let card = false;
  for (const w of windows) {
    if (/subtitle=\{\s*null\s*\}/.test(w)) card = true;
    else if (/subtitle=/.test(w)) return 'yes';
  }
  return card ? 'card' : 'none';
}

/** Что считается «главным действием» на экране. */
const ACTION_PATTERNS: readonly RegExp[] = [
  /<(?:Button|button)\b/,
  /<[A-Z][A-Za-z]*Button\b/,
  /<form\b/,
  /<(?:ExportLink|BackLink)\b/,
  // Ссылка в цветах проекта: кнопка-ссылка (`bg-[#F97316]`) или карточка
  // «что вы хотите сделать?» с оранжевой рамкой при наведении — так устроены
  // хабы («Главная», «Обмен с 1С»).
  /<Link\b[^>]*className=[^>]*#F97316/,
];

const REDIRECT = /\b(?:redirect|permanentRedirect|redirectToSettingsHub)\(/;

/**
 * Признаки экрана по цепочке исходников: первым идёт `page.tsx`, за ним —
 * его компоненты. Порядок важен только для заголовка: побеждает первая шапка.
 */
export function analyzeScreen(sources: readonly string[]): ScreenSignals {
  // Стрелкой, а не `map(stripComments)`: иначе номер элемента ушёл бы в
  // `keepLayout`, и комментарии компонентов заменялись бы пробелами.
  const clean = sources.map((src) => stripComments(src));
  const joined = clean.join('\n');
  const windows = clean.flatMap(headerWindows);
  const title = classifyTitle(windows, joined);
  const page = clean[0] ?? '';
  return {
    title,
    subtitle: classifySubtitle(windows),
    action: ACTION_PATTERNS.some((re) => re.test(joined)),
    emptyState: /<EmptyState\b/.test(joined),
    gateway: title === 'none' && REDIRECT.test(page),
  };
}

const answersWhereAmI = (s: ScreenSignals) => s.title === 'ru' || s.title === 'dynamic';
const answersWhatHere = (s: ScreenSignals) => s.subtitle !== 'none';
const answersWhatNext = (s: ScreenSignals) => s.action || s.emptyState;

/** Таблица «кабинет → экранов → где я / что здесь / что дальше». */
export function summarize(rows: readonly ScreenRow[]): CabinetSummary[] {
  const out: CabinetSummary[] = [];
  for (const cabinet of [...CABINETS, 'other'] as const) {
    const mine = rows.filter((r) => r.cabinet === cabinet);
    if (mine.length === 0) continue;
    const screens = mine.filter((r) => !r.signals.gateway);
    out.push({
      cabinet,
      screens: mine.length,
      gateways: mine.length - screens.length,
      whereAmI: screens.filter((r) => answersWhereAmI(r.signals)).length,
      whatHere: screens.filter((r) => answersWhatHere(r.signals)).length,
      whatNext: screens.filter((r) => answersWhatNext(r.signals)).length,
    });
  }
  return out;
}

/** Экраны, где хотя бы один из трёх вопросов без ответа (шлюзы не считаются). */
export function findGaps(rows: readonly ScreenRow[]): ScreenGap[] {
  const gaps: ScreenGap[] = [];
  for (const r of rows) {
    if (r.signals.gateway) continue;
    const missing: string[] = [];
    if (!answersWhereAmI(r.signals)) missing.push(`где я (заголовок: ${r.signals.title})`);
    if (!answersWhatHere(r.signals)) missing.push('что здесь (нет подзаголовка)');
    if (!answersWhatNext(r.signals)) missing.push('что дальше (нет кнопки и пустого состояния)');
    if (missing.length > 0) gaps.push({ route: r.route, file: r.file, missing });
  }
  return gaps;
}

/** Markdown-таблица для close-out — в том же виде, что у `У-77`. */
export function renderSummary(summary: readonly CabinetSummary[]): string {
  const lines = [
    '| Кабинет | Экранов всего | Где я | Что здесь | Что дальше |',
    '|---|---|---|---|---|',
  ];
  for (const s of summary) {
    const n = s.screens - s.gateways;
    const total = s.gateways > 0 ? `${s.screens} (шлюзов: ${s.gateways})` : `${s.screens}`;
    lines.push(
      `| ${CABINET_LABELS[s.cabinet]} | ${total} | ${s.whereAmI} из ${n} | ${s.whatHere} из ${n} | ${s.whatNext} из ${n} |`
    );
  }
  return lines.join('\n');
}

/** Детерминированный генератор (mulberry32): одно зерно — одна выборка. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: readonly T[], rnd: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

/**
 * Воспроизводимая выборка «глазами» (`У-77`, `У-175`): `n` экранов из списка
 * по зерну `seed`. Берётся по кругу из каждого кабинета — так в выборку
 * попадает не меньше одного экрана каждого кабинета, а при `n ≥ 2·кабинетов`
 * не меньше двух; остаток уходит кабинетам с бо́льшим числом экранов.
 * Порядок входного списка не влияет: он сортируется до перемешивания.
 */
export function pickSample(files: readonly string[], n: number, seed: number): string[] {
  const groups = new Map<ScreenCabinet, string[]>();
  for (const f of [...files].sort()) {
    const cabinet = cabinetOf(f);
    const list = groups.get(cabinet);
    if (list) list.push(f);
    else groups.set(cabinet, [f]);
  }
  const rnd = mulberry32(seed);
  // Группы идут в порядке первого появления — а список уже отсортирован.
  const shuffled = [...groups.values()].map((list) => shuffle(list, rnd));
  const picked: string[] = [];
  for (let round = 0; picked.length < n; round++) {
    const before = picked.length;
    for (const list of shuffled) {
      const f = list[round];
      if (f !== undefined && picked.length < n) picked.push(f);
    }
    if (picked.length === before) break;
  }
  return picked;
}
