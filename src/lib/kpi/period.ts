import { startOfMoscowMonth } from '@/lib/dates/calendar';

/**
 * Месяц отчёта из адреса (`?month=YYYY-MM`). Мусор и отсутствие — текущий
 * месяц **по Москве**: сервер живёт по Гринвичу, и 1-го числа с 00:00 до 03:00
 * экран открывал бы прошлый месяц (та же грабля, что у границ периодов).
 */
export function parseKpiMonth(raw: string | undefined): { year: number; month: number } {
  const m = typeof raw === 'string' ? /^(\d{4})-(\d{2})$/.exec(raw) : null;
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  // Начало московского месяца в UTC — это 21:00 предыдущих суток; сдвиг на три
  // часа возвращает нас в тот месяц, который сейчас идёт в Москве.
  const moscowMonth = new Date(startOfMoscowMonth().getTime() + 3 * 60 * 60 * 1000);
  return { year: moscowMonth.getUTCFullYear(), month: moscowMonth.getUTCMonth() + 1 };
}
