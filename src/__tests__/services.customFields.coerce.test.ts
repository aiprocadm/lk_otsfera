/**
 * Этап 1 ТЗ v0.5 (§11) — валидация и хранение 12 типов настраиваемых полей.
 *
 * Unit-уровень: `coerce.ts` — чистый модуль без Prisma. Здесь же закрываются
 * границы, из-за которых «строковая каша» в колонке `value` могла бы поехать:
 * копейки у денег, дубли в множественном выборе, `javascript:` в ссылке.
 */
import { describe, it, expect } from 'vitest';
import type { CustomFieldType } from '@prisma/client';
import {
  validateFieldValue,
  normalizeValue,
  parseMultiselect,
  serializeMultiselect,
  requiresOptions,
  FIELD_TYPE_LABELS,
  TEXT_MAX,
  TEXTAREA_MAX,
  EMAIL_MAX,
  URL_MAX
} from '@/lib/services/customFields/coerce';

const OPTS = ['low', 'medium', 'high'];

describe('coerce — таблица «тип × значение»', () => {
  const cases: Array<[CustomFieldType, string, boolean, string]> = [
    // короткий текст
    ['text', 'Договор №1', true, 'обычная строка'],
    ['text', 'x'.repeat(TEXT_MAX), true, 'ровно предел'],
    ['text', 'x'.repeat(TEXT_MAX + 1), false, 'на символ длиннее предела'],

    // многострочный текст
    ['textarea', 'первая\nвторая', true, 'перенос строки'],
    ['textarea', 'x'.repeat(TEXTAREA_MAX), true, 'ровно предел'],
    ['textarea', 'x'.repeat(TEXTAREA_MAX + 1), false, 'длиннее предела'],

    // число
    ['number', '150000', true, 'целое'],
    ['number', '-3.5', true, 'дробное отрицательное'],
    ['number', '  ', false, 'пробелы'],
    ['number', 'сто', false, 'не число'],
    ['number', 'Infinity', false, 'бесконечность'],

    // деньги
    ['money', '12345.67', true, 'две цифры после точки'],
    ['money', '100', true, 'без копеек'],
    ['money', '-50.00', true, 'возврат'],
    ['money', '12.345', false, 'три знака после точки — потеря копеек'],
    ['money', '12,50', false, 'запятая вместо точки'],
    ['money', '1 000', false, 'пробел-разделитель'],

    // дата
    ['date', '2026-12-31', true, 'ISO-дата'],
    ['date', '2026-02-31', false, 'несуществующее 31 февраля'],
    ['date', '31.12.2026', false, 'русский формат'],
    ['date', '2026-12-31T10:00:00Z', false, 'дата со временем — это datetime'],

    // дата и время
    ['datetime', '2026-12-31T10:00:00Z', true, 'ISO с временем'],
    ['datetime', '2026-12-31T10:00', true, 'значение из input datetime-local'],
    ['datetime', '2026-12-31', false, 'без времени'],
    ['datetime', 'вчера', false, 'не дата'],

    // да/нет
    ['boolean', 'true', true, 'истина'],
    ['boolean', 'false', true, 'ложь'],
    ['boolean', 'True', false, 'регистр важен'],
    ['boolean', '1', false, 'единица не булево'],

    // выбор одного
    ['select', 'high', true, 'вариант из списка'],
    ['select', 'urgent', false, 'варианта нет в списке'],

    // множественный выбор
    ['multiselect', '["low","high"]', true, 'два варианта'],
    ['multiselect', '["low","low"]', false, 'дубль'],
    ['multiselect', '["low","urgent"]', false, 'вариант вне списка'],
    ['multiselect', '[]', false, 'пустой массив — это очистка, не значение'],
    ['multiselect', 'low,high', false, 'не JSON'],
    ['multiselect', '{"a":1}', false, 'JSON, но не массив'],
    ['multiselect', '[1,2]', false, 'массив не строк'],

    // телефон
    ['phone', '+79161234567', true, 'с плюсом'],
    ['phone', '8 (916) 123-45-67', true, 'с разделителями — нормализуется'],
    ['phone', '1234', false, 'слишком короткий'],
    ['phone', '+7916abc4567', false, 'буквы'],

    // почта
    ['email', 'user@example.com', true, 'обычный адрес'],
    ['email', 'user@example', false, 'домен без точки'],
    ['email', 'user example@mail.ru', false, 'пробел'],
    ['email', `${'x'.repeat(EMAIL_MAX)}@mail.ru`, false, 'длиннее предела'],

    // ссылка
    ['url', 'https://example.com/doc', true, 'https'],
    ['url', 'http://example.com', true, 'http'],
    ['url', 'javascript:alert(1)', false, 'javascript: — вектор XSS'],
    ['url', 'data:text/html,<h1>x</h1>', false, 'data:'],
    ['url', 'file:///etc/passwd', false, 'file:'],
    ['url', 'example.com', false, 'без схемы'],
    ['url', `https://e.com/${'x'.repeat(URL_MAX)}`, false, 'длиннее предела']
  ];

  for (const [type, value, expected, note] of cases) {
    it(`${type}: ${note} → ${expected ? 'валидно' : 'невалидно'}`, () => {
      expect(validateFieldValue(type, OPTS, value)).toBe(expected);
    });
  }
});

describe('coerce — нормализация', () => {
  it('phone: разделители вырезаются', () => {
    expect(normalizeValue('phone', '8 (916) 123-45-67')).toBe('89161234567');
  });

  it('остальные типы не трогаются', () => {
    expect(normalizeValue('text', '  как есть  ')).toBe('  как есть  ');
    expect(normalizeValue('money', '10.50')).toBe('10.50');
  });
});

describe('coerce — multiselect', () => {
  it('сериализация и разбор — обратимы', () => {
    const values = ['low', 'high'];
    expect(parseMultiselect(serializeMultiselect(values))).toEqual(values);
  });

  it('битая строка → null, а не исключение', () => {
    expect(parseMultiselect('не json')).toBeNull();
    expect(parseMultiselect('"строка"')).toBeNull();
    expect(parseMultiselect('[1]')).toBeNull();
  });
});

describe('coerce — справочные данные', () => {
  it('варианты обязательны только для select и multiselect', () => {
    expect(requiresOptions('select')).toBe(true);
    expect(requiresOptions('multiselect')).toBe(true);
    expect(requiresOptions('text')).toBe(false);
    expect(requiresOptions('boolean')).toBe(false);
  });

  it('русская подпись есть у всех 12 типов', () => {
    expect(Object.keys(FIELD_TYPE_LABELS)).toHaveLength(12);
    for (const label of Object.values(FIELD_TYPE_LABELS)) {
      expect(label.length).toBeGreaterThan(0);
    }
  });
});
