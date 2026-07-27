/**
 * Единые форматтеры пользовательских значений (₽, даты). Заменяют локальные
 * fmtMoney/таймстампы по компонентам — «250000 ₽» и смесь dd/mm/yy форматов.
 *
 * даты всегда рендерятся в московском времени (`Europe/Moscow`) — вывод не зависит от TZ сервера/CI;
 * `fmtMoney` намеренно без копеек (`maximumFractionDigits: 0`) — экраны, где копейки значимы (детали заказа), при sweep НЕ переводить на этот форматтер.
 */
const MONEY = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });

export function fmtMoney(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${MONEY.format(n)} ₽`;
}

export function fmtDate(value: Date | string): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
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
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
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
