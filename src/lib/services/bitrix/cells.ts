import { parseIsoCalendarDate } from '@/lib/dates/calendar';
import { parseMoscowWallClock } from '@/lib/dates/wallClock';

/**
 * Значения ячеек выгрузки Битрикс24 (CSV через exceljs и XLSX) → примитивы
 * источника. Одна точка на все пять сущностей: даты выгрузки приходят в
 * портальном формате «ДД.ММ.ГГГГ ЧЧ:ММ:СС» без часового пояса, суммы — с
 * пробелами-разрядами и запятой, «да/нет» — словами, мультиполя — через
 * запятую или перенос строки.
 */

/** Текст ячейки: строки, числа, даты, rich text, формулы и ссылки exceljs. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as { richText?: Array<{ text?: unknown }>; text?: unknown; result?: unknown };
    if (Array.isArray(o.richText)) {
      // Куски rich text склеиваются как есть — пробел между ними значим.
      return o.richText
        .map((t) => (t.text === null || t.text === undefined ? '' : String(t.text)))
        .join('')
        .trim();
    }
    if ('text' in o) return cellText(o.text);
    if ('result' in o) return cellText(o.result);
    return '';
  }
  return String(v).trim();
}

export function cellTextOrNull(v: unknown): string | null {
  const s = cellText(v);
  return s ? s : null;
}

/** Только цифры (ИНН, КПП); пусто → null. Excel мог отдать число — сначала текст. */
export function cellDigitsOrNull(v: unknown): string | null {
  const digits = cellText(v).replace(/\D/g, '');
  return digits ? digits : null;
}

const RU_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

const pad2 = (n: string): string => n.padStart(2, '0');

/**
 * Дата ячейки. Время суток без пояса — портальный формат, ISO без зоны,
 * дата-ячейка книги Excel — читается как МОСКОВСКОЕ (`Р-М-4`, прогон
 * сопровождения №36): портал заказчика живёт по Москве, и REST того же портала
 * отдаёт те же моменты уже с `+03:00`. Прежде такие значения читались как UTC:
 * лид, созданный в 01:30 по Москве 1 сентября, переносился датой 31 августа, а
 * одна и та же запись из файла и из REST расходилась на три часа.
 *
 * Дата БЕЗ времени («20.12.2025» — срок задачи, дата закрытия сделки) — это
 * календарный день, а не момент. Он остаётся полночью UTC — в том же виде, в
 * каком день пишет поле даты формы (`parseIsoCalendarDate`): иначе форма
 * сделки, заполняющая поле по `toISOString()`, показала бы перенесённую
 * сделку вчерашним днём.
 *
 * Несуществующий день («31.02.2026») и время вроде «25:00» → `null`: в
 * предпросмотре уверенная неправда хуже пустоты.
 */
export function cellDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : excelCellDate(v);
  const s = cellText(v);
  if (!s) return null;
  const ru = s.match(RU_DATE);
  if (ru) {
    // День, месяц и год (и минуты при часах) в шаблоне обязательны — пустые
    // умолчания нужны только проверке типов (`noUncheckedIndexedAccess`).
    const [, dd = '', mm = '', yyyy = '', hh, mi = '', ss = '0'] = ru;
    const day = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    return hh === undefined
      ? parseIsoCalendarDate(day)
      : parseMoscowWallClock(`${day}T${pad2(hh)}:${mi}:${pad2(ss)}`);
  }
  if (ISO_NO_ZONE.test(s)) {
    return s.length === 10 ? parseIsoCalendarDate(s) : parseMoscowWallClock(s.replace(' ', 'T'));
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Дата-ячейка книги Excel. Excel пояса не хранит, и exceljs отдаёт цифры ячейки
 * в полях UTC: «03.11.2025 09:00» приходит как `09:00Z`. Время суток
 * перечитываем по Москве — иначе XLSX и CSV одной выгрузки расходились бы на
 * три часа. Ровная полночь — ячейка «только дата»: это календарный день, и он
 * уже в нужном виде (полночь UTC), как у «20.12.2025» из CSV.
 */
function excelCellDate(v: Date): Date | null {
  const wallClock = v.toISOString().slice(0, 23);
  return wallClock.endsWith('T00:00:00.000') ? v : parseMoscowWallClock(wallClock);
}

/** Мультиполе («Телефон»: несколько значений через запятую/точку с запятой/перенос). */
export function cellList(v: unknown): string[] {
  return cellText(v)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const YES = new Set(['y', 'yes', 'да', 'true', '1']);

/** «Сделка закрыта»: Y / Да / Yes / true / 1. */
export function cellFlag(v: unknown): boolean {
  return YES.has(cellText(v).toLowerCase());
}

/**
 * Сумма: «120 000,00», «120000.00», «120000|RUB», «45 000 руб.» → «120000» /
 * «45000». Не число → как есть (предпросмотр покажет, что не разобралось).
 */
export function cellMoney(v: unknown): string | null {
  // `split` всегда возвращает хотя бы один кусок — индекс 0 доказуемо есть.
  const raw = cellText(v).split('|')[0]!;
  const s = raw.replace(/[^\d.,-]/g, '');
  if (!s) return null;
  let normalized = s;
  const comma = s.indexOf(',');
  const dot = s.indexOf('.');
  if (comma >= 0 && dot >= 0) {
    // Оба знака: первый — разряды, второй — дробная часть.
    normalized = comma < dot ? s.replaceAll(',', '') : s.replaceAll('.', '').replace(',', '.');
  } else if (comma >= 0) {
    normalized = s.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : raw.trim();
}
