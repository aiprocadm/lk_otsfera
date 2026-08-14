import { describe, it, expect } from 'vitest';
import { parseIsoCalendarDate, parseRuCalendarDate } from '@/lib/dates/calendar';

/**
 * Разбор календарной даты (общий помощник).
 *
 * Появился после того, как один и тот же промах нашёлся в **четырёх** местах:
 * дата рождения сотрудника (два пути импорта), ожидаемая дата закрытия сделки
 * и дата платежа из банковской выписки. Везде проверяли «подходит под шаблон и
 * не Invalid Date» — а JavaScript считает 30 февраля законной датой и молча
 * переносит её на 2 марта.
 */
describe('parseIsoCalendarDate', () => {
  it('обычная дата разбирается в полночь UTC', () => {
    expect(parseIsoCalendarDate('1990-02-01')?.toISOString()).toBe('1990-02-01T00:00:00.000Z');
  });

  it('пробелы по краям не мешают', () => {
    expect(parseIsoCalendarDate('  1990-02-01  ')?.toISOString()).toBe('1990-02-01T00:00:00.000Z');
  });

  it('29 февраля в високосный год — законная дата', () => {
    expect(parseIsoCalendarDate('2024-02-29')).not.toBeNull();
  });

  it('29 февраля в невисокосный год — нет такого дня', () => {
    // Главная проверка: JS отдал бы 1 марта, и человек не увидел бы ошибки.
    expect(parseIsoCalendarDate('2023-02-29')).toBeNull();
  });

  it('30 февраля и 31 апреля отвергаются, а не «переезжают»', () => {
    expect(parseIsoCalendarDate('1990-02-30')).toBeNull();
    expect(parseIsoCalendarDate('2025-04-31')).toBeNull();
  });

  it('13-й месяц и 99-е число отвергаются', () => {
    expect(parseIsoCalendarDate('2025-13-01')).toBeNull();
    expect(parseIsoCalendarDate('2025-01-99')).toBeNull();
  });

  it('другой формат или мусор — null, а не догадка', () => {
    // `new Date('5')` в JS — это 1 мая 2001 года; догадок не допускаем.
    for (const bad of ['5', '01.02.1990', '1990/02/01', '1990-2-1', '', 'вчера']) {
      expect(parseIsoCalendarDate(bad), bad).toBeNull();
    }
  });
});

describe('parseRuCalendarDate', () => {
  it('«01.02.1990» — это 1 февраля, а не 2 января', () => {
    expect(parseRuCalendarDate('01.02.1990')?.toISOString()).toBe('1990-02-01T00:00:00.000Z');
  });

  it('несуществующий день отвергается так же', () => {
    expect(parseRuCalendarDate('30.02.1990')).toBeNull();
    expect(parseRuCalendarDate('31.04.2025')).toBeNull();
  });

  it('однозначные числа без нуля и другой формат — null', () => {
    for (const bad of ['1.2.1990', '1990-02-01', 'не дата']) {
      expect(parseRuCalendarDate(bad), bad).toBeNull();
    }
  });
});
