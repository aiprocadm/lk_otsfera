/**
 * Единые форматтеры пользовательских значений (₽, даты). Заменяют локальные
 * fmtMoney/таймстампы по компонентам — «250000 ₽» и смесь dd/mm/yy форматов.
 *
 * даты всегда рендерятся в московском времени (`Europe/Moscow`) — вывод не зависит от TZ сервера/CI;
 * `fmtMoney` намеренно без копеек (`maximumFractionDigits: 0`) — экраны, где копейки значимы (детали заказа), при sweep НЕ переводить на этот форматтер.
 */
import { moscowYearMonth } from '@/lib/dates/calendar';

const MONEY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function fmtMoney(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${MONEY.format(n)} ₽`;
}

export function fmtDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Moscow',
  });
}

export function fmtDateTime(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}

const MONTHS_LONG = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
];

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

/**
 * Подпись периода ведомости комиссии: «август 2026» (`long`, PDF/XLSX) или
 * «авг 2026» (`short`, экраны), если начало и конец лежат в одном
 * **московском** месяце; иначе «дд.мм.гггг — дд.мм.гггг» по Москве.
 *
 * Прогон сопровождения №36 (спека `2026-09-23-moscow-time-in-server-code`,
 * группа Б). Расчёт ведомости режет месяц по московским границам (`Д-22`):
 * август — это `2026-07-31T21:00Z … 2026-08-31T20:59:59.999Z`. Пять копий
 * подписи сравнивали месяцы по часам процесса (UTC) — и денежный документ
 * печатал «31.07.2026 — 31.08.2026», а январская ведомость — даже прошлый год.
 * На экране партнёра та же копия давала ошибку гидратации: сервер (UTC) и
 * браузер (Москва) рисовали разный текст. Одна функция вместо пяти копий.
 */
export function fmtMonthPeriod(
  from: Date | string,
  to: Date | string,
  style: 'short' | 'long'
): string {
  const f = typeof from === 'string' ? new Date(from) : from;
  const t = typeof to === 'string' ? new Date(to) : to;
  // Кривая дата не должна ронять страницу: `Intl.format` бросает на Invalid Date.
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return '—';
  const month = moscowYearMonth(f);
  if (month !== moscowYearMonth(t)) return `${fmtDate(f)} — ${fmtDate(t)}`;
  const names = style === 'long' ? MONTHS_LONG : MONTHS_SHORT;
  // `ГГГГ-ММ`: месяц 01…12 — индекс массива всегда существует.
  return `${names[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
}

/** Календарная дата в московском времени как `YYYY-MM-DD` — для сравнения «тот же день». */
function moscowDayKey(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

/**
 * Этап 9 (ФТ-11.3): отметка последнего входа в списках пользователей.
 * `null`/мусор → «—», сегодняшний вход → «сегодня, 14:32», остальное → «12.07.2026».
 * «Сегодня» считается по московскому дню — как и остальные форматтеры файла.
 */
export function fmtLastLogin(value: Date | string | null | undefined): string {
  if (value == null) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  if (moscowDayKey(d) === moscowDayKey(new Date())) {
    const time = d.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
    return `сегодня, ${time}`;
  }
  return fmtDate(d);
}

/**
 * Русский плюрализатор: pluralizeRu(2, 'заказ','заказа','заказов') -> 'заказа'.
 * Заменяет дословно скопированную локальную `pluralize` в partner/deals и organization/orders.
 */
export function pluralizeRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
