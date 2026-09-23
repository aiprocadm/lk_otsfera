import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/lib/acceptance/screenRules';
import { readSourceKeepingLines } from './helpers/source';

/**
 * Всё, что видит человек, показывается по Москве — явно, а не по часам
 * процесса (прогон сопровождения №36, спека
 * `2026-09-23-moscow-time-in-server-code-design`, §3 и §5).
 *
 * Серверы проекта живут в UTC, браузеры заказчиков — в Москве. Формат даты
 * без `timeZone` берёт пояс того, кто рисует: сервер печатает «22.09 21:30»,
 * браузер той же записи — «23.09 00:30». Итог — либо неверный день в PDF,
 * письме и выгрузке, либо ошибка гидратации на экране (сервер и браузер
 * нарисовали разный текст). Спека насчитала 47 таких мест группы А; они
 * починены, а этот страж не даёт появиться новым.
 *
 * Четыре правила по исходникам `src/**` (кроме тестов; комментарии не в счёт):
 *   1. `.toLocaleDateString(` / `.toLocaleTimeString(` / `Intl.DateTimeFormat(`
 *      — только с `timeZone` в списке аргументов этого же вызова, и не
 *      `timeZone: undefined` (это «пояс процесса», записанный явно).
 *   2. `.toLocaleString(` — то же, если получатель не число: `Number(…)` или
 *      запись в `NUMERIC_RECEIVERS` с причиной.
 *   3. Местные геттеры/сеттеры (`getMonth`, `setHours`, …) — только в файлах
 *      из `LOCAL_CLOCK_FILES` с причиной.
 *   4. Форматтер упоминается только прямым вызовом (прогон №37): псевдоним
 *      `const F = Intl.DateTimeFormat` + `new F(…)`, доступ `d['toLocaleString']`
 *      и ссылка без вызова обходили правила 1–2 — там нет текста вызова, у
 *      которого можно проверить аргументы.
 */
const ROOT = join(__dirname, '..', '..');

/**
 * Вызовы, которым пояс нужен всегда: у них получатель — всегда дата. Пробел
 * перед скобкой и `?.` — тот же вызов (прогон №37: `d.toLocaleDateString (…)`
 * прежний шаблон не видел).
 */
const ALWAYS_DATE =
  /\.\s*toLocaleDateString\s*\(|\.\s*toLocaleTimeString\s*\(|\bIntl\s*\??\.\s*DateTimeFormat\s*\(/g;

/** `toLocaleString` есть и у чисел — там пояс не нужен. */
const LOCALE_STRING = /\.\s*toLocaleString\s*\(/g;

/**
 * Пояс задан: `timeZone` есть, и это не `undefined`/`void 0` — такая запись
 * означает «пояс процесса», то есть ровно то, от чего страж защищает.
 */
const HAS_ZONE = /\btimeZone\b(?!\s*:\s*(?:undefined\b|void\b))/;

/** Любое упоминание имени форматтера (правило 4). */
const FORMATTER_NAME =
  /\b(?:toLocaleDateString|toLocaleTimeString|toLocaleString|DateTimeFormat)\b/g;

/** Прямой вызов: после имени — только пробелы и `(`. */
const CALL_FOLLOWS = /\s*\(/y;

/** Геттеры и сеттеры, которые читают/пишут дату в поясе процесса. */
const LOCAL_CLOCK =
  /\.(getMonth|getDate|getDay|getHours|getFullYear|setHours|setDate|setMonth|setFullYear)\(/g;

/**
 * Числа, у которых `toLocaleString` — разряды, а не дата. Запись — точный
 * текст получателя в конкретном файле: другой получатель в том же файле
 * проверяется как обычно.
 */
const NUMERIC_RECEIVERS: Array<{ file: string; receiver: string; reason: string }> = [
  {
    file: 'src/lib/services/commission/pdf.ts',
    receiver: 'n',
    reason:
      'сумма ведомости с копейками: `n` — число из `Number(value)` строкой выше, пояс к нему неприменим',
  },
  {
    file: 'src/components/documents/document-detail-view.tsx',
    receiver: 'doc.payment.paid',
    reason:
      'поступившая по счёту сумма: поле `paid: number` вида карточки документа, а не момент времени',
  },
];

/**
 * Файлы, где местные геттеры законны. Пуст с прогона №36: все найденные
 * места (сетка календаря, срок в форме выпуска документа, группировка
 * документов по году) переведены на московские помощники `lib/dates`.
 * Новая запись — только с причиной, почему пояс процесса здесь не ошибка.
 */
const LOCAL_CLOCK_FILES: Array<{ file: string; reason: string }> = [];

/**
 * Упоминания `Intl.DateTimeFormat` без вызова, законные по смыслу: это ТИП
 * значения, а не форматтер. Запись — точный текст строки (без отступа) в
 * конкретном файле: псевдоним на соседней строке того же файла проверяется
 * как обычно.
 */
const TYPE_REFERENCES: Array<{ file: string; lines: string[]; reason: string }> = [
  {
    file: 'src/lib/jobs/cron.ts',
    lines: [
      'const offsetFormatters = new Map<string, Intl.DateTimeFormat>();',
      'const partsFormatters = new Map<string, Intl.DateTimeFormat>();',
      'function offsetFormatter(tz: string): Intl.DateTimeFormat {',
      'function partsFormatter(tz: string): Intl.DateTimeFormat {',
    ],
    reason:
      'тип кэша форматтеров по поясу: каждый создаётся в этом же файле вызовом ' +
      '`new Intl.DateTimeFormat(…, { timeZone: tz })`, и сам вызов проверяет правило 1',
  },
];

function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => !f.startsWith('src/__tests__/') && !f.startsWith('src/e2e/'));
}

/** Позиция закрывающей скобки вызова, открытого на `open` (`src[open] === '('`). */
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Текст аргументов вызова; `null` — скобка не закрылась (считаем нарушением). */
function argsText(src: string, open: number): string | null {
  const close = closingParen(src, open);
  return close === -1 ? null : src.slice(open + 1, close);
}

/**
 * Получатель вызова `<получатель>.toLocaleString(`: идём назад от точки через
 * имена, точки, `?.`/`!` и сбалансированные `(…)`/`[…]`; `new ` перед ним —
 * часть получателя (`new Date(x)`).
 */
function receiverOf(src: string, dot: number): string {
  let i = dot - 1;
  while (i >= 0 && /\s/.test(src[i] ?? '')) i -= 1;
  const end = i + 1;
  while (i >= 0) {
    const ch = src[i] ?? '';
    if (ch === ')' || ch === ']') {
      let depth = 0;
      for (; i >= 0; i -= 1) {
        const c = src[i];
        if (c === ')' || c === ']') depth += 1;
        else if (c === '(' || c === '[') depth -= 1;
        if (depth === 0) break;
      }
      i -= 1;
      continue;
    }
    if (/[\w$.?!]/.test(ch)) {
      i -= 1;
      continue;
    }
    break;
  }
  let start = i + 1;
  const newKw = /\bnew\s+$/.exec(src.slice(Math.max(0, start - 10), start));
  if (newKw) start -= newKw[0].length;
  return src.slice(start, end).trim();
}

/** `Number(…)` целиком — число по построению. */
function isNumberCall(receiver: string): boolean {
  if (!receiver.startsWith('Number(')) return false;
  return closingParen(receiver, 'Number'.length) === receiver.length - 1;
}

type Hit = { line: number; text: string };

function hitAt(src: string, index: number): Hit {
  const line = src.slice(0, index).split('\n').length;
  return { line, text: (src.split('\n')[line - 1] ?? '').trim() };
}

/** Правило 1: вызовы-«всегда дата» без `timeZone` в своих аргументах. */
function missingZoneAlways(src: string): Hit[] {
  const out: Hit[] = [];
  for (const m of src.matchAll(ALWAYS_DATE)) {
    const open = m.index + m[0].length - 1;
    const args = argsText(src, open);
    if (args === null || !HAS_ZONE.test(args)) out.push(hitAt(src, m.index));
  }
  return out;
}

/** Правило 2: `toLocaleString` у не-числа без `timeZone`. */
function missingZoneLocaleString(src: string, numeric: ReadonlySet<string>): Hit[] {
  const out: Hit[] = [];
  for (const m of src.matchAll(LOCALE_STRING)) {
    const open = m.index + m[0].length - 1;
    const args = argsText(src, open);
    if (args !== null && HAS_ZONE.test(args)) continue;
    const receiver = receiverOf(src, m.index);
    if (isNumberCall(receiver) || numeric.has(receiver)) continue;
    out.push(hitAt(src, m.index));
  }
  return out;
}

/** Правило 3: местные геттеры/сеттеры. */
function localClock(src: string): Hit[] {
  return [...src.matchAll(LOCAL_CLOCK)].map((m) => hitAt(src, m.index));
}

/**
 * Правило 4: имя форматтера не в виде прямого вызова. `toLocale*String` —
 * только после `.` (или `?.`), `DateTimeFormat` — только после `Intl.`; и там
 * и там дальше обязана стоять `(`. Всё прочее — псевдоним, доступ через
 * `['…']`, ссылка на метод, деструктуризация — обход: у такой записи нет
 * списка аргументов, и правила 1–2 её не видят.
 */
function indirectFormatterRefs(src: string): Hit[] {
  const out: Hit[] = [];
  for (const m of src.matchAll(FORMATTER_NAME)) {
    const before = src.slice(Math.max(0, m.index - 20), m.index);
    const owner = m[0] === 'DateTimeFormat' ? /\bIntl\s*\??\.\s*$/ : /\.\s*$/;
    CALL_FOLLOWS.lastIndex = m.index + m[0].length;
    if (owner.test(before) && CALL_FOLLOWS.test(src)) continue;
    out.push(hitAt(src, m.index));
  }
  return out;
}

const format = (file: string, hits: Hit[]) => hits.map((h) => `${file}:${h.line}  ${h.text}`);

describe('даты: показ по Москве — пояс задан явно (прогон №36)', () => {
  const files = sourceFiles();
  const sources = new Map(files.map((f) => [f, readSourceKeepingLines(join(ROOT, f))]));

  it('обход видит компоненты, сервисы, воркер и файлы верхнего уровня', () => {
    expect(files.length).toBeGreaterThan(1000);
    for (const f of [
      'src/lib/format.ts',
      'src/middleware.ts',
      'src/components/tasks/task-list.tsx',
      'src/worker/processors/calendar-reminder.ts',
    ]) {
      expect(files, `${f} не попал в обход — страж слеп`).toContain(f);
    }
    expect(files.some((f) => f.startsWith('src/__tests__/'))).toBe(false);
  });

  it('разбор вызова: пояс в многострочных опциях виден, число без пояса не нарушение', () => {
    const numeric = new Set<string>();
    expect(missingZoneAlways("d.toLocaleDateString('ru-RU')")).toHaveLength(1);
    expect(
      missingZoneAlways(
        "new Intl.DateTimeFormat('ru-RU', {\n  day: '2-digit',\n  timeZone: 'Europe/Moscow',\n})"
      )
    ).toEqual([]);
    // `timeZone` соседнего вызова не засчитывается чужому.
    expect(
      missingZoneAlways("f(d.toLocaleDateString('ru-RU'), { timeZone: 'Europe/Moscow' })")
    ).toHaveLength(1);
    expect(missingZoneLocaleString("Number(x).toLocaleString('ru-RU')", numeric)).toEqual([]);
    expect(missingZoneLocaleString("Number(a) + b.toLocaleString('ru-RU')", numeric)).toHaveLength(
      1
    );
    expect(missingZoneLocaleString("new Date(at).toLocaleString('ru-RU')", numeric)).toHaveLength(
      1
    );
    expect(
      missingZoneLocaleString(
        "new Date(at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })",
        numeric
      )
    ).toEqual([]);
    expect(
      missingZoneLocaleString(
        "doc.payment.paid.toLocaleString('ru-RU')",
        new Set(['doc.payment.paid'])
      )
    ).toEqual([]);
    expect(localClock('const y = d.getFullYear();\nd.setHours(0);')).toEqual([
      { line: 1, text: 'const y = d.getFullYear();' },
      { line: 2, text: 'd.setHours(0);' },
    ]);
  });

  it('обходы прогона №37: пробел перед скобкой и timeZone: undefined — это вызов без пояса', () => {
    expect(missingZoneAlways("d.toLocaleDateString ('ru-RU')")).toHaveLength(1);
    expect(missingZoneAlways("d?.toLocaleTimeString('ru-RU')")).toHaveLength(1);
    expect(missingZoneAlways("new Intl . DateTimeFormat ('ru-RU')")).toHaveLength(1);
    expect(
      missingZoneAlways("d.toLocaleDateString('ru-RU', { timeZone: undefined, day: '2-digit' })")
    ).toHaveLength(1);
    expect(
      missingZoneAlways("new Intl.DateTimeFormat('ru-RU', { timeZone: void 0 })")
    ).toHaveLength(1);
    expect(
      missingZoneLocaleString(
        "new Date(at).toLocaleString('ru-RU', { timeZone: undefined })",
        new Set()
      )
    ).toHaveLength(1);
    // Пояс из переменной (`timeZone: tz`, `{ timeZone }`) — законная запись.
    expect(missingZoneAlways("new Intl.DateTimeFormat('en-US', { timeZone: tz })")).toEqual([]);
    expect(missingZoneAlways("d.toLocaleDateString('ru-RU', { timeZone })")).toEqual([]);
  });

  it('обходы прогона №37: псевдоним, доступ через [...] и ссылка без вызова — нарушение правила 4', () => {
    expect(
      indirectFormatterRefs("const F = Intl.DateTimeFormat;\nnew F('ru-RU').format(d);")
    ).toEqual([{ line: 1, text: 'const F = Intl.DateTimeFormat;' }]);
    expect(indirectFormatterRefs('const { DateTimeFormat } = Intl;')).toHaveLength(1);
    expect(indirectFormatterRefs("const I = Intl;\nnew I.DateTimeFormat('ru-RU');")).toHaveLength(
      1
    );
    expect(indirectFormatterRefs("d['toLocaleDateString']('ru-RU')")).toHaveLength(1);
    expect(indirectFormatterRefs('d["toLocaleString"]()')).toHaveLength(1);
    expect(indirectFormatterRefs('const f = d.toLocaleTimeString;\nf.call(d);')).toHaveLength(1);
    // Прямые вызовы правило 4 не трогает — их аргументы проверяют правила 1–2.
    expect(
      indirectFormatterRefs(
        "d.toLocaleDateString('ru-RU'); d?.toLocaleString(); n.toLocaleString ('ru-RU');\n" +
          "new Intl.DateTimeFormat('ru-RU'); Intl?.DateTimeFormat('ru-RU'); fmtDateTimeFormat;"
      )
    ).toEqual([]);
  });

  it('адрес в строке больше не прячет вызов на той же строке (прогон №37)', () => {
    // Прежний разбор комментариев считал `//` из `'https://…'` началом
    // комментария и стирал остаток строки вместе с вызовом без пояса.
    const src = "const u = 'https://lk.otsfera.ru'; const s = d.toLocaleDateString('ru-RU');";
    expect(missingZoneAlways(stripComments(src, true))).toEqual([{ line: 1, text: src }]);
  });

  it('правило 1: toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat — только с timeZone', () => {
    const offenders = files.flatMap((f) => format(f, missingZoneAlways(sources.get(f) ?? '')));
    expect(
      offenders,
      'Дата форматируется без пояса: сервер (UTC) и браузер (Москва) покажут разный ' +
        "день. Возьми fmtDate/fmtDateTime из `lib/format.ts` или добавь timeZone: 'Europe/Moscow':\n" +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('правило 2: toLocaleString у даты — только с timeZone', () => {
    const offenders = files.flatMap((f) => {
      const numeric = new Set(NUMERIC_RECEIVERS.filter((e) => e.file === f).map((e) => e.receiver));
      return format(f, missingZoneLocaleString(sources.get(f) ?? '', numeric));
    });
    expect(
      offenders,
      'toLocaleString без пояса: если это дата — возьми fmtDateTime из `lib/format.ts`; ' +
        'если число — оберни в Number(…) или запиши получатель в NUMERIC_RECEIVERS с причиной:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('правило 3: местные геттеры и сеттеры даты — только в файлах из списка с причиной', () => {
    const allowed = new Set(LOCAL_CLOCK_FILES.map((e) => e.file));
    const offenders = files
      .filter((f) => !allowed.has(f))
      .flatMap((f) => format(f, localClock(sources.get(f) ?? '')));
    expect(
      offenders,
      'getMonth/getDate/setHours и т. п. читают дату в поясе процесса (UTC на сервере): ' +
        'с 00:00 до 03:00 по Москве это ещё вчера. Возьми помощники `lib/dates/calendar.ts` ' +
        '(moscowCalendarDay, moscowYearMonth, startOfMoscowDay):\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('правило 4: форматтер упоминается только прямым вызовом (прогон №37)', () => {
    const allowed = new Set(TYPE_REFERENCES.flatMap((e) => e.lines.map((l) => `${e.file}|${l}`)));
    const offenders = files.flatMap((f) =>
      format(
        f,
        indirectFormatterRefs(sources.get(f) ?? '').filter((h) => !allowed.has(`${f}|${h.text}`))
      )
    );
    expect(
      offenders,
      'Форматтер даты взят не прямым вызовом (псевдоним, доступ через [...], ссылка на метод): ' +
        'правила 1–2 не видят его аргументов и не проверят пояс. Вызывай напрямую ' +
        '(`new Intl.DateTimeFormat(…, { timeZone })`, `d.toLocaleDateString(…)`) или, если это ' +
        'тип, запиши строку в TYPE_REFERENCES с причиной:\n' +
        offenders.join('\n')
    ).toEqual([]);
  });

  it('списки исключений живые: у каждой записи причина, и место ещё существует', () => {
    for (const e of NUMERIC_RECEIVERS) {
      expect(e.reason.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
      const src = sources.get(e.file) ?? '';
      const receivers = [...src.matchAll(LOCALE_STRING)].map((m) => receiverOf(src, m.index));
      expect(
        receivers,
        `${e.file}: получателя «${e.receiver}» больше нет — убери запись`
      ).toContain(e.receiver);
    }
    for (const e of LOCAL_CLOCK_FILES) {
      expect(e.reason.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
      expect(
        localClock(sources.get(e.file) ?? ''),
        `${e.file}: геттеров больше нет — убери запись`
      ).not.toEqual([]);
    }
    for (const e of TYPE_REFERENCES) {
      expect(e.reason.length, `${e.file}: причина не записана`).toBeGreaterThan(40);
      const texts = indirectFormatterRefs(sources.get(e.file) ?? '').map((h) => h.text);
      for (const line of e.lines) {
        expect(texts, `${e.file}: строки «${line}» больше нет — убери её из записи`).toContain(
          line
        );
      }
    }
  });
});
