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

/**
 * Дата ячейки. Портальный формат и ISO без зоны читаются как UTC — выгрузка
 * не сообщает пояс портала, а детерминированный результат важнее «местного»
 * времени сервера (предпросмотр показывает дни, а не минуты).
 */
export function cellDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = cellText(v);
  if (!s) return null;
  const ru = s.match(RU_DATE);
  if (ru) {
    const [, dd, mm, yyyy, hh = '0', mi = '0', ss = '0'] = ru;
    const d = new Date(
      Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss))
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(ISO_NO_ZONE.test(s) ? `${s.replace(' ', 'T')}Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
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
  const raw = cellText(v).split('|')[0] ?? '';
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
