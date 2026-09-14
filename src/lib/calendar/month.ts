/**
 * M5 — чистая математика месячной сетки календаря (Monday-first, 6 недель).
 * Используется и страницей (диапазон выборки ±хвосты), и клиентской сеткой —
 * единый источник, чтобы серверная выборка совпадала с рендером по дням.
 *
 * **Сутки здесь московские** (`Д-22`, прогон №28). Раньше сетка считалась
 * арифметикой часового пояса процесса, а сервер живёт по Гринвичу: встреча,
 * назначенная на 01:00 по Москве, приходилась на 22:00 предыдущего дня UTC —
 * и серверная выборка, и группировка по ячейкам ставили её во вчерашнюю
 * клетку. На экране человек видел встречу не в тот день.
 *
 * Москва не переходит на летнее время с 2014 года, поэтому московские сутки
 * ровно 24 часа: от московской полуночи можно шагать миллисекундами, не
 * пересчитывая зону на каждом шаге.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MOSCOW = 'Europe/Moscow';

/** Московская полночь 1-го числа месяца `ГГГГ-ММ`. */
function moscowFirstDay(month: string): Date {
  return new Date(`${month}-01T00:00:00+03:00`);
}

/**
 * День недели по Москве, Пн = 0 … Вс = 6.
 *
 * Считается арифметикой, а не `Intl`: у московской полуночи смещение всегда
 * `+03:00`, поэтому «московское местное время» — это UTC плюс три часа.
 */
function moscowWeekday(d: Date): number {
  return (new Date(d.getTime() + 3 * 60 * 60 * 1000).getUTCDay() + 6) % 7;
}

/** `ГГГГ-ММ` из номера месяца, который мог уехать за границы года. */
function monthKey(year: number, monthIndex: number): string {
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}

export const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?m=YYYY-MM` → валидный месяц или месяц опорной даты (fallback) по Москве. */
export function normalizeMonthParam(raw: string | undefined, fallback: Date): string {
  if (raw && MONTH_PARAM_RE.test(raw)) return raw;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
  }).format(fallback);
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number);
  return { year: y as number, monthIndex: (m as number) - 1 };
}

/** Понедельник недели 1-го числа (может лежать в прошлом месяце). */
export function monthGridStart(month: string): Date {
  const first = moscowFirstDay(month);
  return new Date(first.getTime() - moscowWeekday(first) * DAY_MS);
}

/** Диапазон выборки [from, to): сетка 6×7 дней с хвостами соседних месяцев. */
export function monthGridRange(month: string): { from: Date; to: Date } {
  const from = monthGridStart(month);
  return { from, to: new Date(from.getTime() + 42 * DAY_MS) };
}

/** 42 дня сетки по порядку. */
export function monthGridDays(month: string): Date[] {
  const start = monthGridStart(month);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * DAY_MS));
}

/** Ключ дня `ГГГГ-ММ-ДД` ПО МОСКВЕ (группировка чипов по ячейкам). */
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MOSCOW,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isSameMonth(d: Date, month: string): boolean {
  return dayKey(d).slice(0, 7) === month;
}

export function prevMonth(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  return monthKey(year, monthIndex - 1);
}

export function nextMonth(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  return monthKey(year, monthIndex + 1);
}

const MONTHS_RU = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export function monthLabel(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  return `${MONTHS_RU[monthIndex]} ${year}`;
}
