/**
 * M5 — unit-тесты чистых date-хелперов месячной сетки (Monday-first, 6 недель).
 * Все даты — локальные (new Date(y, m, d)), как в самом модуле.
 */
import { describe, it, expect } from 'vitest';
import {
  MONTH_PARAM_RE,
  normalizeMonthParam,
  monthGridStart,
  monthGridRange,
  monthGridDays,
  dayKey,
  isSameMonth,
  prevMonth,
  nextMonth,
  monthLabel,
} from '@/lib/calendar/month';

describe('normalizeMonthParam', () => {
  const fallback = new Date(2026, 6, 17); // 17 июля 2026

  it('валидный параметр возвращается как есть', () => {
    expect(normalizeMonthParam('2026-07', fallback)).toBe('2026-07');
    expect(normalizeMonthParam('1999-12', fallback)).toBe('1999-12');
  });

  it('невалидный/undefined → месяц опорной даты (с pad нуля)', () => {
    expect(normalizeMonthParam(undefined, fallback)).toBe('2026-07');
    expect(normalizeMonthParam('2026-13', fallback)).toBe('2026-07');
    expect(normalizeMonthParam('2026-00', fallback)).toBe('2026-07');
    expect(normalizeMonthParam('garbage', fallback)).toBe('2026-07');
    expect(normalizeMonthParam('2026-7', fallback)).toBe('2026-07');
    expect(normalizeMonthParam('', new Date(2025, 10, 1))).toBe('2025-11');
  });

  it('MONTH_PARAM_RE принимает только YYYY-MM с месяцем 01–12', () => {
    expect(MONTH_PARAM_RE.test('2026-01')).toBe(true);
    expect(MONTH_PARAM_RE.test('2026-12')).toBe(true);
    expect(MONTH_PARAM_RE.test('2026-1')).toBe(false);
  });
});

describe('monthGridStart', () => {
  it('месяц, начинающийся с понедельника: старт = 1-е число (июнь 2026)', () => {
    // 1 июня 2026 — понедельник.
    expect(monthGridStart('2026-06')).toEqual(new Date(2026, 5, 1));
  });

  it('месяц не с понедельника: старт — понедельник в хвосте прошлого месяца', () => {
    // 1 июля 2026 — среда → старт 29 июня (понедельник).
    expect(monthGridStart('2026-07')).toEqual(new Date(2026, 5, 29));
    // 1 февраля 2026 — воскресенье → старт 26 января.
    expect(monthGridStart('2026-02')).toEqual(new Date(2026, 0, 26));
  });
});

describe('monthGridRange / monthGridDays', () => {
  it('диапазон [from, to) — ровно 42 дня', () => {
    const { from, to } = monthGridRange('2026-07');
    expect(from).toEqual(new Date(2026, 5, 29));
    expect(to).toEqual(new Date(2026, 7, 10)); // 29.06 + 42 дня = 10.08
    expect((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)).toBe(42);
  });

  it('monthGridDays: 42 дня по порядку, границы совпадают с range', () => {
    const days = monthGridDays('2026-07');
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual(new Date(2026, 5, 29));
    expect(days[41]).toEqual(new Date(2026, 7, 9)); // последний день < to
    // монотонность по суткам
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe('dayKey / isSameMonth', () => {
  it('dayKey — локальный YYYY-MM-DD c pad', () => {
    expect(dayKey(new Date(2026, 6, 5))).toBe('2026-07-05');
    expect(dayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('isSameMonth: внутри месяца true, соседние месяцы/годы false', () => {
    expect(isSameMonth(new Date(2026, 6, 15), '2026-07')).toBe(true);
    expect(isSameMonth(new Date(2026, 5, 30), '2026-07')).toBe(false);
    expect(isSameMonth(new Date(2025, 6, 15), '2026-07')).toBe(false);
  });
});

describe('prevMonth / nextMonth', () => {
  it('внутри года', () => {
    expect(prevMonth('2026-07')).toBe('2026-06');
    expect(nextMonth('2026-07')).toBe('2026-08');
  });

  it('переходы через год', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(nextMonth('2026-12')).toBe('2027-01');
  });
});

describe('monthLabel', () => {
  it('русское имя месяца + год', () => {
    expect(monthLabel('2026-07')).toBe('Июль 2026');
    expect(monthLabel('2025-01')).toBe('Январь 2025');
    expect(monthLabel('2030-12')).toBe('Декабрь 2030');
  });
});
