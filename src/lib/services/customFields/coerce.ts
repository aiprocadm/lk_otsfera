/**
 * §11 ТЗ v0.5 — единственное место, где значение настраиваемого поля
 * превращается в строку колонки `CustomFieldValue.value` и обратно.
 *
 * Колонка одна и строковая, типов двенадцать — поэтому контракт хранения
 * фиксируется здесь, а не расползается по формам и карточкам:
 *
 *   text/textarea/phone/email/url/select — как есть
 *   number                               — десятичная строка
 *   money                                — строка "12345.67" (НЕ float: копейки)
 *   date                                 — 'YYYY-MM-DD'
 *   datetime                             — ISO 8601 с временем
 *   boolean                              — 'true' | 'false'
 *   multiselect                          — JSON-массив строк '["a","b"]'
 */

import type { CustomFieldType } from '@prisma/client';

// ─── Ограничения длины ───────────────────────────────────────────────────────

export const TEXT_MAX = 500;
export const TEXTAREA_MAX = 5000;
export const EMAIL_MAX = 254;
export const URL_MAX = 2000;

// ─── Регэкспы ────────────────────────────────────────────────────────────────

/** Денежная сумма: целая часть + до двух знаков после точки, допускается минус. */
const MONEY_RE = /^-?\d+(\.\d{1,2})?$/;

/** Телефон: цифры, необязательный ведущий «+», 5–20 знаков после нормализации. */
const PHONE_RE = /^\+?\d{5,20}$/;

/** E-mail: RFC-lite — одна «собака», без пробелов, точка в домене. */
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/** Дата без времени. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Русские подписи типов (для экрана настройки, PR-2) ──────────────────────

export const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Короткий текст',
  textarea: 'Многострочный текст',
  number: 'Число',
  money: 'Денежная сумма',
  date: 'Дата',
  datetime: 'Дата и время',
  boolean: 'Да / Нет',
  select: 'Выбор одного значения',
  multiselect: 'Множественный выбор',
  phone: 'Телефон',
  email: 'E-mail',
  url: 'Ссылка',
};

/** Типы, которым обязателен непустой список вариантов. */
export function requiresOptions(fieldType: CustomFieldType): boolean {
  return fieldType === 'select' || fieldType === 'multiselect';
}

// ─── Разбор multiselect ──────────────────────────────────────────────────────

/**
 * Читает хранимое значение multiselect. Возвращает null, если строка не является
 * JSON-массивом строк — вызывающий сам решает, показать «—» или ошибку.
 */
export function parseMultiselect(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((x) => typeof x === 'string')) return null;
  return parsed as string[];
}

/** Сериализует выбранные варианты в хранимую строку. */
export function serializeMultiselect(values: string[]): string {
  return JSON.stringify(values);
}

// ─── Нормализация перед записью ──────────────────────────────────────────────

/**
 * Приводит значение к каноничному виду хранения. Вызывается ПОСЛЕ валидации.
 * Сейчас нормализуется только телефон (пробелы, скобки и дефисы из ввода) —
 * остальные типы хранятся как пришли.
 */
export function normalizeValue(fieldType: CustomFieldType, value: string): string {
  if (fieldType === 'phone') {
    return value.replace(/[\s()\-.]/g, '');
  }
  return value;
}

// ─── Валидация ───────────────────────────────────────────────────────────────

/**
 * Валидна ли строка для типа поля. Пустую строку сюда НЕ передают: пустое
 * значение означает очистку поля и проверяется отдельно (см. setValues).
 */
export function validateFieldValue(
  fieldType: CustomFieldType,
  options: string[],
  value: string
): boolean {
  switch (fieldType) {
    case 'text':
      return value.length <= TEXT_MAX;

    case 'textarea':
      return value.length <= TEXTAREA_MAX;

    case 'number': {
      const n = Number(value);
      return value.trim() !== '' && Number.isFinite(n);
    }

    case 'money':
      return MONEY_RE.test(value);

    case 'date':
      // Строгий формат + реальность даты: '2026-02-31' парсится Date'ом со
      // сдвигом на март, поэтому сверяем обратное форматирование.
      if (!DATE_RE.test(value)) return false;
      return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

    case 'datetime': {
      const d = new Date(value);
      // Дата без времени не годится: тип называется «дата и время».
      return !isNaN(d.getTime()) && !DATE_RE.test(value);
    }

    case 'boolean':
      return value === 'true' || value === 'false';

    case 'select':
      return options.includes(value);

    case 'multiselect': {
      const parsed = parseMultiselect(value);
      if (parsed === null) return false;
      if (parsed.length === 0) return false; // пусто = очистка, сюда не доходит
      if (new Set(parsed).size !== parsed.length) return false; // дубли
      return parsed.every((v) => options.includes(v));
    }

    case 'phone':
      return PHONE_RE.test(normalizeValue('phone', value));

    case 'email':
      return value.length <= EMAIL_MAX && EMAIL_RE.test(value);

    case 'url': {
      if (value.length > URL_MAX) return false;
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return false;
      }
      // Только http/https: javascript:, data: и file: — вектор XSS/утечки.
      return url.protocol === 'http:' || url.protocol === 'https:';
    }

    /* v8 ignore next 2 -- недостижимо: CustomFieldType закрыт, все ветки выше.
       Ветка нужна как страховка на случай добавления значения в enum. */
    default:
      return false;
  }
}
