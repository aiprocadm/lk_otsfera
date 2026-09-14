/**
 * M5 — unit-тесты чистых date-хелперов месячной сетки (Monday-first, 6 недель).
 *
 * Все даты — МОСКОВСКИЕ (`Д-22`, прогон №28): сутки сетки начинаются в
 * московскую полночь, то есть в 21:00 предыдущего дня по Гринвичу. Раньше
 * модуль считал арифметикой часового пояса процесса, и встреча на 01:00 по
 * Москве попадала во вчерашнюю клетку и в выборку прошлого месяца. Поэтому
 * тесты пишутся смещением `+03:00`, а не `new Date(y, m, d)` — иначе они
 * закрепляли бы именно тот промах, который чинится.
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

/** Московская полночь указанного дня. */
const msk = (iso: string) => new Date(`${iso}T00:00:00+03:00`);

describe('normalizeMonthParam', () => {
  const fallback = msk('2026-07-17'); // 17 июля 2026 по Москве

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
    expect(normalizeMonthParam('', msk('2025-11-01'))).toBe('2025-11');
    // Ночь 1-го числа по Москве — это ещё прошлые сутки по Гринвичу; месяц
    // обязан остаться ноябрьским, иначе календарь откроется на октябре.
    expect(normalizeMonthParam('', new Date('2025-10-31T22:30:00Z'))).toBe('2025-11');
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
    expect(monthGridStart('2026-06')).toEqual(msk('2026-06-01'));
  });

  it('месяц не с понедельника: старт — понедельник в хвосте прошлого месяца', () => {
    // 1 июля 2026 — среда → старт 29 июня (понедельник).
    expect(monthGridStart('2026-07')).toEqual(msk('2026-06-29'));
    // 1 февраля 2026 — воскресенье → старт 26 января.
    expect(monthGridStart('2026-02')).toEqual(msk('2026-01-26'));
  });
});

describe('monthGridRange / monthGridDays', () => {
  it('диапазон [from, to) — ровно 42 дня', () => {
    const { from, to } = monthGridRange('2026-07');
    expect(from).toEqual(msk('2026-06-29'));
    expect(to).toEqual(msk('2026-08-10')); // 29.06 + 42 дня = 10.08
    expect((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)).toBe(42);
  });

  it('monthGridDays: 42 дня по порядку, границы совпадают с range', () => {
    const days = monthGridDays('2026-07');
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual(msk('2026-06-29'));
    expect(days[41]).toEqual(msk('2026-08-09')); // последний день < to
    // монотонность по суткам
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i].getTime() - days[i - 1].getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe('dayKey / isSameMonth', () => {
  it('dayKey — МОСКОВСКИЙ YYYY-MM-DD c pad', () => {
    expect(dayKey(msk('2026-07-05'))).toBe('2026-07-05');
    expect(dayKey(msk('2026-12-31'))).toBe('2026-12-31');
  });

  it('встреча в 01:00 по Москве попадает в СЕГОДНЯШНЮЮ клетку, а не во вчерашнюю', () => {
    // 22:00 UTC 4 июля — это 5 июля 01:00 по Москве. Прежняя арифметика зоны
    // процесса ставила такую встречу в клетку 4 июля.
    expect(dayKey(new Date('2026-07-04T22:00:00Z'))).toBe('2026-07-05');
  });

  it('isSameMonth: внутри месяца true, соседние месяцы/годы false', () => {
    expect(isSameMonth(msk('2026-07-15'), '2026-07')).toBe(true);
    expect(isSameMonth(msk('2026-06-30'), '2026-07')).toBe(false);
    expect(isSameMonth(msk('2025-07-15'), '2026-07')).toBe(false);
    // Полночь 1 июля по Москве — уже июль, хотя по Гринвичу ещё 30 июня.
    expect(isSameMonth(msk('2026-07-01'), '2026-07')).toBe(true);
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
