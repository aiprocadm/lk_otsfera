/**
 * M5 — чистая математика месячной сетки календаря (Monday-first, 6 недель).
 * Используется и страницей (диапазон выборки ±хвосты), и клиентской сеткой —
 * единый источник, чтобы серверная выборка совпадала с рендером по дням.
 */

export const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `?m=YYYY-MM` → валидный месяц или месяц опорной даты (fallback). */
export function normalizeMonthParam(raw: string | undefined, fallback: Date): string {
  if (raw && MONTH_PARAM_RE.test(raw)) return raw;
  return `${fallback.getFullYear()}-${String(fallback.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonth(month: string): { year: number; monthIndex: number } {
  const [y, m] = month.split('-').map(Number);
  return { year: y as number, monthIndex: (m as number) - 1 };
}

/** Понедельник недели 1-го числа (может лежать в прошлом месяце). */
export function monthGridStart(month: string): Date {
  const { year, monthIndex } = parseMonth(month);
  const first = new Date(year, monthIndex, 1);
  const offset = (first.getDay() + 6) % 7; // Mo=0 … Su=6
  return new Date(year, monthIndex, 1 - offset);
}

/** Диапазон выборки [from, to): сетка 6×7 дней с хвостами соседних месяцев. */
export function monthGridRange(month: string): { from: Date; to: Date } {
  const from = monthGridStart(month);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 42);
  return { from, to };
}

/** 42 дня сетки по порядку. */
export function monthGridDays(month: string): Date[] {
  const start = monthGridStart(month);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  );
}

/** Локальный ключ дня YYYY-MM-DD (группировка чипов по ячейкам). */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isSameMonth(d: Date, month: string): boolean {
  const { year, monthIndex } = parseMonth(month);
  return d.getFullYear() === year && d.getMonth() === monthIndex;
}

export function prevMonth(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  const d = new Date(year, monthIndex - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function nextMonth(month: string): string {
  const { year, monthIndex } = parseMonth(month);
  const d = new Date(year, monthIndex + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
