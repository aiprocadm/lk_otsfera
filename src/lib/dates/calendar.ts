/**
 * Разбор календарной даты, введённой человеком или пришедшей из файла.
 *
 * **Зачем отдельный модуль.** JavaScript считает «30 февраля» и «31 апреля»
 * законными датами и молча переносит их на 2 марта и 1 мая. Проверки вида
 * «подходит под шаблон + не `Invalid Date`» этого не ловят: они пропускают
 * несуществующий день, и человек получает чужую дату рождения или чужой день
 * платежа, не увидев ни одной ошибки. Один и тот же промах нашёлся в четырёх
 * местах — поэтому правило живёт здесь, а не переписывается в каждом.
 *
 * Приём один: разобрать, а потом собрать обратно и сверить со входом. Если
 * дата «переехала» — значит, такого дня в календаре нет.
 */

/** Строгий формат `ГГГГ-ММ-ДД`. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Формат `ДД.ММ.ГГГГ` — так дату печатает 1С и так её пишут в Excel. */
const RU_DAY = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/**
 * `ГГГГ-ММ-ДД` → полночь UTC или `null`, если такой даты не существует.
 *
 * Возвращает именно `null`, а не «ближайшую похожую»: пустое поле честнее
 * выдуманного значения, а вызывающий превращает `null` в понятную ошибку.
 */
export function parseIsoCalendarDate(raw: string): Date | null {
  const text = raw.trim();
  if (!ISO_DAY.test(text)) return null;

  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  // Сверка «туда-обратно»: 1990-02-30 разберётся, но соберётся уже как
  // 1990-03-02 — значит, дня не существует.
  return date.toISOString().slice(0, 10) === text ? date : null;
}

/**
 * `ДД.ММ.ГГГГ` → полночь UTC или `null`. Та же сверка «туда-обратно».
 */
export function parseRuCalendarDate(raw: string): Date | null {
  const m = RU_DAY.exec(raw.trim());
  if (!m) return null;
  return parseIsoCalendarDate(`${m[3]}-${m[2]}-${m[1]}`);
}

/**
 * Начало текущих суток **по московскому времени** (`Д-22`).
 *
 * `new Date(...).setHours(0, 0, 0, 0)` даёт полночь в часовом поясе процесса,
 * а серверы проекта живут в UTC. С 00:00 до 03:00 по Москве такая «полночь»
 * указывает на ПРЕДЫДУЩИЕ сутки московского календаря: удостоверение,
 * истёкшее вчера, ещё считалось действующим, а «дела на сегодня» показывали
 * вчерашний день. Наружу же всё рендерится в `Europe/Moscow` (`lib/format.ts`),
 * и расхождение видел только тот, кто работал ночью.
 *
 * Решение то же, что у года документа в `documents/generate.ts`: календарную
 * дату берём через `Intl` в московской зоне. Смещение записано явным `+03:00`
 * — Москва не переходит на летнее время с 2014 года, зона фиксированная.
 *
 * Локаль `en-CA` даёт ровно `YYYY-MM-DD` (та же причина, что и у `moscowYear`).
 */
export function startOfMoscowDay(now: Date = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${ymd}T00:00:00+03:00`);
}

/**
 * Начало текущего месяца **по московскому времени** (`Д-22`, прогон №28).
 *
 * `new Date(now.getFullYear(), now.getMonth(), 1)` — тот же промах, что и
 * `setHours(0, 0, 0, 0)`, только крупнее: он берёт и год, и месяц в часовом
 * поясе процесса. Замер на сервере (UTC): 1 сентября в 01:30 по Москве такой
 * код считает текущим месяцем **август** и отдаёт границу `01.08` — то есть
 * сводка за «этот месяц» три часа подряд показывает весь прошлый.
 */
export function startOfMoscowMonth(now: Date = new Date()): Date {
  return moscowMonthStart(moscowYearMonth(now));
}

/**
 * Начало текущего года по Москве. Та же причина: 1 января с 00:00 до 03:00
 * «текущим годом» оказывался предыдущий.
 */
export function startOfMoscowYear(now: Date = new Date()): Date {
  return new Date(`${moscowYearMonth(now).slice(0, 4)}-01-01T00:00:00+03:00`);
}

/**
 * Полуоткрытый диапазон месяца по Москве: `[1-е 00:00, 1-е следующего 00:00)`.
 * Год и месяц приходят от человека (выбор периода в отчётах), поэтому берутся
 * как есть, а московской делается только граница.
 */
export function moscowMonthRange(year: number, month: number): { from: Date; to: Date } {
  const from = moscowMonthStart(`${year}-${String(month).padStart(2, '0')}`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const to = moscowMonthStart(`${nextYear}-${String(nextMonth).padStart(2, '0')}`);
  return { from, to };
}

/** `ГГГГ-ММ` текущего момента по Москве. */
function moscowYearMonth(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

/** `ГГГГ-ММ` → московская полночь 1-го числа. */
function moscowMonthStart(yearMonth: string): Date {
  return new Date(`${yearMonth}-01T00:00:00+03:00`);
}
