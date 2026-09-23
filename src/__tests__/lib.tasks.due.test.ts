import { describe, it, expect } from 'vitest';
import {
  dueByWhere,
  dueWithinDaysWhere,
  isPastDue,
  moscowDaysUntil,
  pastDueWhere,
} from '@/lib/tasks/due';

/**
 * Правило сроков по московскому дню (`Р-М-3`, прогон сопровождения №36).
 *
 * Сроки — такие, какие пишут настоящие писатели:
 *  - форма задачи (`server-actions/tasks` → `new Date(<input type="date">)`) и
 *    форма удостоверения (`POST /api/manager/certificates`) — полночь UTC,
 *    то есть 03:00 МСК того же дня;
 *  - адаптер Битрикс24 (`adapter-rest.ts`, `DEADLINE` с поясом портала) —
 *    «16.09 01:30 МСК» приходит как 15.09 22:30 UTC.
 *
 * Моменты «сейчас» — на краях суток: 00:00–03:00 МСК, когда сервер в UTC ещё
 * живёт вчерашним днём, и 21:00–24:00 UTC, когда в Москве уже завтра.
 */

const FORM = (ymd: string) => new Date(ymd);
const MSK = (local: string) => new Date(`${local}+03:00`);

/** Как условие выборки ответило бы на строку со сроком `due`. */
function matches(filter: { gte?: Date; lt?: Date }, due: Date): boolean {
  return (
    (filter.gte === undefined || due.getTime() >= filter.gte.getTime()) &&
    (filter.lt === undefined || due.getTime() < filter.lt.getTime())
  );
}

describe('moscowDaysUntil — номер московского дня срока от сегодняшнего', () => {
  it('срок из формы: сегодня 0, завтра 1, вчера −1 — в любой час московских суток', () => {
    for (const now of [
      MSK('2026-09-16T00:00:00'), // 15.09 21:00 UTC — сервер ещё во вчера
      MSK('2026-09-16T02:59:59'),
      MSK('2026-09-16T12:00:00'),
      MSK('2026-09-16T23:59:59'), // 20:59 UTC
    ]) {
      expect(moscowDaysUntil(FORM('2026-09-16'), now)).toBe(0);
      expect(moscowDaysUntil(FORM('2026-09-17'), now)).toBe(1);
      expect(moscowDaysUntil(FORM('2026-09-15'), now)).toBe(-1);
    }
  });

  it('срок Битрикс24 со временем — по ЕГО московскому дню', () => {
    const now = MSK('2026-09-16T00:30:00'); // 15.09 21:30 UTC
    // «16.09 01:30 МСК» = 15.09 22:30 UTC: по UTC это «вчера», по Москве — сегодня.
    expect(moscowDaysUntil(MSK('2026-09-16T01:30:00'), now)).toBe(0);
    // Ровно 00:00 МСК — первая секунда дня, а 23:59 — последняя.
    expect(moscowDaysUntil(MSK('2026-09-16T00:00:00'), now)).toBe(0);
    expect(moscowDaysUntil(MSK('2026-09-16T23:59:59'), now)).toBe(0);
    expect(moscowDaysUntil(MSK('2026-09-15T23:59:59'), now)).toBe(-1);
  });

  it('вчерашний срок не даёт «−0»: деление округляется вниз', () => {
    // Прежние формулы с `Math.ceil` давали `ceil(-0.875) = -0`, а `-0 < 0` ложно.
    const days = moscowDaysUntil(FORM('2026-09-15'), MSK('2026-09-16T00:30:00'));
    expect(Object.is(days, -0)).toBe(false);
    expect(days < 0).toBe(true);
  });
});

describe('isPastDue — срок прошёл, когда закончился его московский день', () => {
  it('срок из формы не просрочен весь свой день и просрочен с 00:00 МСК следующего', () => {
    const due = FORM('2026-09-16');
    // 03:00 МСК — момент, когда прежнее «срок < сейчас» уже краснело.
    expect(isPastDue(due, MSK('2026-09-16T03:00:00'))).toBe(false);
    expect(isPastDue(due, MSK('2026-09-16T23:59:59'))).toBe(false);
    // 17.09 00:00 МСК = 16.09 21:00 UTC: сервер ещё в 16.09, а день срока кончился.
    expect(isPastDue(due, MSK('2026-09-17T00:00:00'))).toBe(true);
  });

  it('срок Битрикс24 01:30 МСК: час прошёл, день — нет', () => {
    const due = MSK('2026-09-16T01:30:00');
    expect(isPastDue(due, MSK('2026-09-16T02:00:00'))).toBe(false);
    expect(isPastDue(due, MSK('2026-09-17T00:00:00'))).toBe(true);
  });
});

describe('условия выборки согласны с функциями на каждой строке', () => {
  // Сетка сроков: формы (полночь UTC) и Битрикс24 на краях московских суток.
  const DUES = [
    FORM('2026-09-13'),
    FORM('2026-09-14'),
    FORM('2026-09-15'),
    FORM('2026-09-16'),
    FORM('2026-09-17'),
    FORM('2026-09-18'),
    FORM('2026-09-19'),
    MSK('2026-09-15T00:00:00'),
    MSK('2026-09-15T23:59:59'),
    MSK('2026-09-16T00:00:00'),
    MSK('2026-09-16T01:30:00'),
    MSK('2026-09-17T01:30:00'),
    MSK('2026-09-18T02:59:59'),
    MSK('2026-09-19T23:30:00'),
  ];
  const NOWS = [
    MSK('2026-09-16T00:00:00'),
    MSK('2026-09-16T00:30:00'),
    MSK('2026-09-16T02:59:59'),
    MSK('2026-09-16T15:00:00'),
    MSK('2026-09-16T23:59:59'),
  ];

  it('pastDueWhere(now) ⟺ isPastDue ⟺ день срока раньше сегодняшнего', () => {
    for (const now of NOWS) {
      for (const due of DUES) {
        const past = isPastDue(due, now);
        expect(matches(pastDueWhere(now), due)).toBe(past);
        expect(moscowDaysUntil(due, now) < 0).toBe(past);
      }
    }
  });

  it('pastDueWhere(now, N) — идёт N-й день просрочки или дальше', () => {
    for (const now of NOWS) {
      for (const due of DUES) {
        for (const n of [1, 2, 3]) {
          expect(matches(pastDueWhere(now, n), due)).toBe(-moscowDaysUntil(due, now) >= n);
        }
      }
    }
    // Срок «13.09» из формы 16.09 просрочен на 3 дня (14, 15, 16) — уже в
    // 00:30 МСК, пока сервер в UTC ещё живёт 15.09.
    expect(matches(pastDueWhere(MSK('2026-09-16T00:30:00'), 3), FORM('2026-09-13'))).toBe(true);
    expect(matches(pastDueWhere(MSK('2026-09-16T23:59:59'), 3), FORM('2026-09-14'))).toBe(false);
  });

  it('dueByWhere(now, N) — срок не позже дня «сегодня + N», включая просроченные', () => {
    for (const now of NOWS) {
      for (const due of DUES) {
        for (const n of [0, 1, 2]) {
          expect(matches(dueByWhere(now, n), due)).toBe(moscowDaysUntil(due, now) <= n);
        }
      }
    }
  });

  it('dueWithinDaysWhere(now, N) — с сегодняшнего дня по «сегодня + N» включительно', () => {
    for (const now of NOWS) {
      for (const due of DUES) {
        for (const n of [0, 1, 3]) {
          const d = moscowDaysUntil(due, now);
          expect(matches(dueWithinDaysWhere(now, n), due)).toBe(d >= 0 && d <= n);
        }
      }
    }
  });

  it('«просрочено» и «скоро» стыкуются без зазора и без двойного счёта', () => {
    for (const now of NOWS) {
      const within = dueWithinDaysWhere(now, 3);
      expect(within.gte).toEqual(pastDueWhere(now).lt);
      for (const due of DUES) {
        const inPast = matches(pastDueWhere(now), due);
        const inSoon = matches(within, due);
        expect(inPast && inSoon).toBe(false);
        // Всё, что наступает не позже «сегодня + 3», — ровно одно из двух.
        expect(inPast || inSoon).toBe(matches(dueByWhere(now, 3), due));
      }
    }
  });
});
