import { z } from 'zod';

/**
 * Повторяющиеся задачи (`У-221`) — чистый расчёт следующего срока.
 *
 * Здесь нет ни базы, ни Next: правило повторения и арифметика дат нужны и
 * серверу (материализация следующего экземпляра), и форме (подпись «каждые две
 * недели»), поэтому они живут отдельным модулем, как `tasks/links.ts`.
 *
 * **Почему считаем в московском календаре.** Сервер живёт в UTC, а «каждый
 * понедельник» человек понимает по своему календарю. Задача со сроком в 01:00
 * МСК хранится как 22:00 UTC предыдущего дня — по UTC это ВОСКРЕСЕНЬЕ, и
 * еженедельная задача уехала бы на день. Тот же дефект уже ловили у номера
 * документа и у «Моего дня» (`Д-22`).
 */

/** Как часто повторяем. Недели и месяцы покрывают всё, что просил отдел продаж. */
const FREQ = ['daily', 'weekly', 'monthly'] as const;
type RecurrenceFreq = (typeof FREQ)[number];

/**
 * Правило повторения. `byWeekday`/`byMonthDay` поддержаны расчётом, но форма их
 * не показывает (решение PR-6): день недели и день месяца берутся из срока самой
 * задачи. Объяснять человеку разницу между «каждую неделю» и «по понедельникам»
 * нечем — когда срок стоит на понедельник, это одно и то же.
 */
export const recurrenceSchema = z.object({
  freq: z.enum(FREQ),
  /** «Каждые N» — не больше года, иначе это уже не повтор, а напоминание. */
  interval: z.number().int().min(1).max(365),
  /** Дни недели 0…6 (воскресенье — 0), только для `weekly`. */
  byWeekday: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  /** День месяца 1…31, только для `monthly`. 31-е в коротком месяце съедет на последнее число. */
  byMonthDay: z.number().int().min(1).max(31).optional(),
  /** Дата последнего повтора включительно, `ГГГГ-ММ-ДД`. */
  until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type RecurrenceRule = z.infer<typeof recurrenceSchema>;

/** Правило из значения, которое пришло из базы (`Json`) или из формы. */
export function parseRecurrence(raw: unknown): RecurrenceRule | null {
  if (raw === null || raw === undefined) return null;
  const parsed = recurrenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Части московской даты — считаем именно по ним, а не по UTC-геттерам. */
type MoscowParts = { year: number; month: number; day: number; weekday: number };

const MSK_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function moscowParts(date: Date): MoscowParts {
  const [year, month, day] = MSK_FORMAT.format(date).split('-').map(Number);
  // День недели берём у той же календарной даты в UTC — так он не зависит от
  // часа и совпадает с тем, что человек видит в календаре.
  const asUtc = new Date(Date.UTC(year!, month! - 1, day!));
  return { year: year!, month: month!, day: day!, weekday: asUtc.getUTCDay() };
}

/** Сколько дней в месяце (месяц 1…12) — для «31-го числа» в феврале. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Москва — фиксированный UTC+3 с 2014 года, перехода на летнее время нет. */
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Полночь московских суток по календарной дате. Считаем через `Date.UTC`, а не
 * сборкой строки: `Date.UTC(2026, 8, 45)` САМ переносит 45 сентября на 15
 * октября, а строка `2026-09-45` — это просто «Invalid Date». На этом и
 * держится арифметика «плюс N дней» ниже.
 */
function moscowMidnightMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day) - MSK_OFFSET_MS;
}

/**
 * Собирает момент времени из московской календарной даты и времени суток
 * исходного срока. Время не трогаем: задача «каждый вторник к 18:00» должна
 * оставаться к 18:00.
 */
function withMoscowDate(source: Date, year: number, month: number, day: number): Date {
  const parts = moscowParts(source);
  const shift = source.getTime() - moscowMidnightMs(parts.year, parts.month, parts.day);
  return new Date(moscowMidnightMs(year, month, day) + shift);
}

/** Конец последнего разрешённого дня (включительно) — `until` задан датой, не моментом. */
function untilLimit(rule: RecurrenceRule): number | null {
  if (!rule.until) return null;
  const [y, m, d] = rule.until.split('-').map(Number);
  // Конец последнего разрешённого московского дня: `until` задан датой, и срок
  // 18:00 этого дня обязан попасть в серию, а не оказаться «уже позже».
  return moscowMidnightMs(y!, m!, d!) + 24 * 60 * 60 * 1000 - 1;
}

function nextDaily(from: Date, rule: RecurrenceRule): Date {
  const { year, month, day } = moscowParts(from);
  return withMoscowDate(from, year, month, day + rule.interval);
}

function nextWeekly(from: Date, rule: RecurrenceRule): Date {
  const parts = moscowParts(from);
  if (!rule.byWeekday || rule.byWeekday.length === 0) {
    return withMoscowDate(from, parts.year, parts.month, parts.day + rule.interval * 7);
  }
  // Ближайший следующий день недели из списка внутри этой же недели…
  const wanted = [...new Set(rule.byWeekday)].sort((a, b) => a - b);
  const ahead = wanted.find((w) => w > parts.weekday);
  if (ahead !== undefined) {
    return withMoscowDate(from, parts.year, parts.month, parts.day + (ahead - parts.weekday));
  }
  // …иначе первый день списка через `interval` недель.
  const first = wanted[0]!;
  const daysToNextWeekStart = 7 - parts.weekday + first + (rule.interval - 1) * 7;
  return withMoscowDate(from, parts.year, parts.month, parts.day + daysToNextWeekStart);
}

function nextMonthly(from: Date, rule: RecurrenceRule): Date {
  const parts = moscowParts(from);
  const wantedDay = rule.byMonthDay ?? parts.day;
  const zeroBased = parts.month - 1 + rule.interval;
  const year = parts.year + Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  // 31-е в коротком месяце — последнее число, а не «переезд на следующий месяц»
  // (JavaScript сам сделал бы 31 февраля мартом, и задача потерялась бы).
  const day = Math.min(wantedDay, daysInMonth(year, month));
  return withMoscowDate(from, year, month, day);
}

/**
 * Следующий срок после `from` или `null`, если серия закончилась.
 *
 * `null` — это не ошибка, а нормальный конец: `until` в прошлом просто означает
 * «больше не повторять», и вызывающий не должен на этом падать.
 */
export function nextOccurrence(rule: RecurrenceRule, from: Date): Date | null {
  const next =
    rule.freq === 'daily'
      ? nextDaily(from, rule)
      : rule.freq === 'weekly'
        ? nextWeekly(from, rule)
        : nextMonthly(from, rule);

  const limit = untilLimit(rule);
  if (limit !== null && next.getTime() > limit) return null;
  return next;
}

const FREQ_RU: Record<RecurrenceFreq, [string, string, string]> = {
  daily: ['день', 'дня', 'дней'],
  weekly: ['неделю', 'недели', 'недель'],
  monthly: ['месяц', 'месяца', 'месяцев'],
};

/** «Каждый день» / «Каждую неделю» / «Каждый месяц» — род у слов разный. */
const FREQ_RU_ONE: Record<RecurrenceFreq, string> = {
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
};

/** Русское склонение «каждые 2 недели» — 2/3/4 требуют другой формы. */
function pluralRu(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

/** Подпись правила для человека: «Каждые 2 недели, до 31.12.2026». */
export function describeRecurrenceRu(rule: RecurrenceRule): string {
  const head =
    rule.interval === 1
      ? FREQ_RU_ONE[rule.freq]
      : `Каждые ${rule.interval} ${pluralRu(rule.interval, FREQ_RU[rule.freq])}`;
  if (!rule.until) return head;
  const [y, m, d] = rule.until.split('-');
  return `${head}, до ${d}.${m}.${y}`;
}
