/**
 * Разбор cron-выражений и предпросмотр ближайших запусков (`У-125`).
 *
 * **Зачем свой разбор.** Расписание задаётся в интерфейсе, и человек должен
 * увидеть, что именно он задал: пять звёздочек читаются плохо, а ошибка в них
 * тихо останавливает обмен с 1С. Показ ближайших трёх запусков превращает
 * строку из звёздочек и косых черт в три понятные даты.
 *
 * **Почему это подмножество.** Планировщик (BullMQ) понимает больше нашего:
 * имена месяцев и дней, `?`, `L`, `#`. Мы принимаем только простые формы —
 * `*`, число, `a-b`, список через запятую и шаг после косой черты. Правило
 * одностороннее:
 * **всё, что принимаем мы, планировщик тоже примет**. Обратное неверно, и это
 * сознательно: лучше отказать в редком выражении, чем показать человеку
 * выдуманные даты и запустить обмен не тогда, когда он думает.
 *
 * Часовой пояс — тот же, что у расписаний (`DEFAULT_SYNC_TZ`). Смещение
 * вычисляется через `Intl`, а не берётся константой: пояс задан строкой, и
 * страна может его поменять.
 */

/** Границы полей: минуты, часы, день месяца, месяц, день недели. */
const FIELD_RANGES: ReadonlyArray<{ min: number; max: number; name: string }> = [
  { min: 0, max: 59, name: 'минуты' },
  { min: 0, max: 23, name: 'часы' },
  { min: 1, max: 31, name: 'день месяца' },
  { min: 1, max: 12, name: 'месяц' },
  // 7 — тоже воскресенье, как в большинстве реализаций; нормализуем к 0.
  { min: 0, max: 7, name: 'день недели' },
];

export type CronFields = {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** `*` в поле «день месяца» — влияет на правило ИЛИ (см. `dayMatches`). */
  domRestricted: boolean;
  dowRestricted: boolean;
};

export type ParseCronResult =
  | { ok: true; fields: CronFields }
  | { ok: false; error: string };

function parseField(raw: string, index: number): number[] | string {
  const range = FIELD_RANGES[index]!;
  const out = new Set<number>();

  for (const part of raw.split(',')) {
    const chunk = part.trim();
    if (chunk === '') return `${range.name}: пустой элемент списка`;

    const [spec, stepRaw, ...rest] = chunk.split('/');
    if (rest.length > 0) return `${range.name}: лишний «/» в «${chunk}»`;

    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^\d+$/.test(stepRaw)) return `${range.name}: шаг «${stepRaw}» — не число`;
      step = Number(stepRaw);
      if (step < 1) return `${range.name}: шаг должен быть больше нуля`;
    }

    let from: number;
    let to: number;
    if (spec === '*') {
      from = range.min;
      to = range.max;
    } else if (/^\d+$/.test(spec!)) {
      from = Number(spec);
      to = stepRaw === undefined ? from : range.max;
    } else if (/^\d+-\d+$/.test(spec!)) {
      const [a, b] = spec!.split('-').map(Number) as [number, number];
      from = a;
      to = b;
      if (from > to) return `${range.name}: диапазон «${spec}» задом наперёд`;
    } else {
      return `${range.name}: «${chunk}» не разобрано (допустимы *, число, a-b, списки и /шаг)`;
    }

    if (from < range.min || to > range.max) {
      return `${range.name}: значения вне диапазона ${range.min}–${range.max}`;
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }

  return [...out].sort((a, b) => a - b);
}

export function parseCron(expression: string): ParseCronResult {
  const parts = expression.trim().split(/\s+/);
  if (expression.trim() === '') return { ok: false, error: 'Расписание не задано' };
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `Ожидается пять полей (минуты часы день месяц день-недели), а их ${parts.length}`,
    };
  }

  const parsed: number[][] = [];
  for (let i = 0; i < 5; i += 1) {
    const res = parseField(parts[i]!, i);
    if (typeof res === 'string') return { ok: false, error: res };
    if (res.length === 0) return { ok: false, error: `${FIELD_RANGES[i]!.name}: ни одного значения` };
    parsed.push(res);
  }

  // 7 и 0 — оба воскресенье.
  const daysOfWeek = [...new Set(parsed[4]!.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);

  return {
    ok: true,
    fields: {
      minutes: parsed[0]!,
      hours: parsed[1]!,
      daysOfMonth: parsed[2]!,
      months: parsed[3]!,
      daysOfWeek,
      domRestricted: parts[2] !== '*',
      dowRestricted: parts[4] !== '*',
    },
  };
}

/**
 * Форматтеры кэшируются по поясу: создание `Intl.DateTimeFormat` — самая
 * дорогая часть перебора, и в цикле по дням оно съедало почти всё время
 * (замер: 286 мс на семь расписаний против единиц миллисекунд после кэша).
 */
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(tz: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    offsetFormatters.set(tz, f);
  }
  return f;
}

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

/** Смещение пояса в миллисекундах для конкретного момента. */
function zoneOffsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(offsetFormatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    // 24 в полночь — известная особенность hour12:false в некоторых средах.
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return asUtc - at.getTime();
}

/** Момент по стенным часам пояса → метка времени. */
function wallClockToInstant(
  tz: string,
  y: number,
  m: number,
  d: number,
  h: number,
  min: number
): number {
  const guess = Date.UTC(y, m - 1, d, h, min, 0);
  // Одной поправки достаточно: пояса меняются не чаще раза в полгода, а сдвиг
  // на границе перевода стрелок даёт разницу в час, которую вторая поправка
  // уже не меняет.
  return guess - zoneOffsetMs(tz, new Date(guess));
}

/** Части даты по стенным часам пояса. */
function wallClockParts(
  tz: string,
  at: Date
): { y: number; m: number; d: number; dow: number } {
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(at).map((x) => [x.type, x.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(p.year),
    m: Number(p.month),
    d: Number(p.day),
    dow: dowMap[String(p.weekday)] ?? 0,
  };
}

/**
 * Совпадает ли день. Классическое правило cron: если ограничены **оба** поля —
 * день месяца и день недели, — день подходит, когда совпало **любое** из них.
 * Это неочевидно, но так работают все реализации, и планировщик тоже.
 */
function dayMatches(f: CronFields, day: number, dow: number): boolean {
  const byDom = f.daysOfMonth.includes(day);
  const byDow = f.daysOfWeek.includes(dow);
  if (f.domRestricted && f.dowRestricted) return byDom || byDow;
  if (f.domRestricted) return byDom;
  if (f.dowRestricted) return byDow;
  return true;
}

/**
 * Горизонт поиска — четыре года. Хватает и на годовые расписания (три
 * срабатывания укладываются в три года), и с запасом на всё, что реально
 * задают для обмена с 1С. Дальше не идём сознательно: «29 февраля» дало бы
 * три даты только за девять лет, а перебор ради этого — плата, которую платят
 * все остальные расписания.
 */
const SEARCH_DAYS = 1500;

/**
 * Ближайшие запуски после `from`. Может вернуть меньше `count` штук, если
 * выражение срабатывает реже, чем раз в четыре года («29 февраля»). Тогда
 * показываем то, что нашли: честнее меньше, чем выдуманная дата.
 */
export function nextCronRuns(
  expression: string,
  tz: string,
  from: Date,
  count = 3
): Date[] {
  const parsed = parseCron(expression);
  if (!parsed.ok) return [];
  const f = parsed.fields;

  const out: Date[] = [];
  const fromMs = from.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  for (let offset = 0; offset < SEARCH_DAYS && out.length < count; offset += 1) {
    const probe = new Date(fromMs + offset * dayMs);
    const { y, m, d, dow } = wallClockParts(tz, probe);
    if (!f.months.includes(m)) continue;
    if (!dayMatches(f, d, dow)) continue;

    for (const h of f.hours) {
      for (const min of f.minutes) {
        const ts = wallClockToInstant(tz, y, m, d, h, min);
        if (ts <= fromMs) continue;
        out.push(new Date(ts));
        if (out.length >= count) break;
      }
      if (out.length >= count) break;
    }
  }

  // Перебор по дням идёт по возрастанию, но внутри дня час×минута могли дать
  // момент раньше уже добавленного, если день сменился на границе пояса.
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count);
}

/** Пресеты формы: то, что нужно в 95% случаев, без набора звёздочек руками. */
export const CRON_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '*/15 * * * *', label: 'Каждые 15 минут' },
  { value: '0 * * * *', label: 'Каждый час' },
  { value: '0 */6 * * *', label: 'Каждые 6 часов' },
  { value: '0 3 * * *', label: 'Раз в сутки, в 3:00' },
];
