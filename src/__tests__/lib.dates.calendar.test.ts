import { describe, it, expect } from 'vitest';
import {
  moscowCalendarDay,
  moscowDayRange,
  moscowMonthRange,
  moscowRangeFilter,
  moscowYearMonth,
  moscowYearRange,
  parseIsoCalendarDate,
  parseRuCalendarDate,
  startOfMoscowDay,
  startOfMoscowMonth,
  startOfMoscowYear,
} from '@/lib/dates/calendar';

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

describe('startOfMoscowDay (`Д-22`)', () => {
  it('ночью по Москве отдаёт МОСКОВСКУЮ полночь, а не полночь UTC', () => {
    // 8 сентября 01:00 МСК — это ещё 7 сентября 22:00 UTC. Полночь процесса
    // (UTC) указала бы на 7 сентября: именно из-за этого удостоверение,
    // истёкшее вчера, ночью считалось действующим.
    const nightInMoscow = new Date('2026-09-08T01:00:00+03:00');
    expect(startOfMoscowDay(nightInMoscow).toISOString()).toBe('2026-09-07T21:00:00.000Z');
  });

  it('днём отдаёт начало тех же суток', () => {
    const noon = new Date('2026-09-08T12:00:00+03:00');
    expect(startOfMoscowDay(noon).toISOString()).toBe('2026-09-07T21:00:00.000Z');
  });

  it('в 23:59 МСК сутки ещё не сменились', () => {
    const lateEvening = new Date('2026-09-08T23:59:00+03:00');
    expect(startOfMoscowDay(lateEvening).toISOString()).toBe('2026-09-07T21:00:00.000Z');
  });

  it('в 00:01 МСК следующего дня граница уже новая', () => {
    const justAfterMidnight = new Date('2026-09-09T00:01:00+03:00');
    expect(startOfMoscowDay(justAfterMidnight).toISOString()).toBe('2026-09-08T21:00:00.000Z');
  });

  it('результат не зависит от того, как записан тот же момент', () => {
    const asUtc = new Date('2026-09-07T22:00:00Z');
    const asMoscow = new Date('2026-09-08T01:00:00+03:00');
    expect(startOfMoscowDay(asUtc).getTime()).toBe(startOfMoscowDay(asMoscow).getTime());
  });
});

describe('startOfMoscowMonth (`Д-22`, прогон №28)', () => {
  it('в 01:30 МСК 1 сентября текущий месяц — СЕНТЯБРЬ, а не август', () => {
    // Это и есть дефект: сборка даты из частей зоны процесса (сервер в UTC)
    // отдавала границу 01.08, и сводка «за этот месяц» три часа показывала
    // весь прошлый месяц целиком.
    const nightOnFirst = new Date('2026-09-01T01:30:00+03:00');
    expect(startOfMoscowMonth(nightOnFirst).toISOString()).toBe('2026-08-31T21:00:00.000Z');
  });

  it('в 23:59 МСК последнего дня месяц ещё не сменился', () => {
    const lastEvening = new Date('2026-09-30T23:59:00+03:00');
    expect(startOfMoscowMonth(lastEvening).toISOString()).toBe('2026-08-31T21:00:00.000Z');
  });

  it('днём в середине месяца отдаёт начало того же месяца', () => {
    expect(startOfMoscowMonth(new Date('2026-09-15T12:00:00+03:00')).toISOString()).toBe(
      '2026-08-31T21:00:00.000Z'
    );
  });

  it('без аргумента берёт текущий момент', () => {
    const now = startOfMoscowMonth();
    expect(now.getTime()).toBeLessThanOrEqual(Date.now());
    expect(Number.isNaN(now.getTime())).toBe(false);
  });
});

describe('startOfMoscowYear (`Д-22`, прогон №28)', () => {
  it('в 01:30 МСК 1 января текущий год — новый, а не прошлый', () => {
    const nightOnNewYear = new Date('2026-01-01T01:30:00+03:00');
    expect(startOfMoscowYear(nightOnNewYear).toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });

  it('в 23:59 МСК 31 декабря год ещё прежний', () => {
    expect(startOfMoscowYear(new Date('2026-12-31T23:59:00+03:00')).toISOString()).toBe(
      '2025-12-31T21:00:00.000Z'
    );
  });

  it('без аргумента берёт текущий момент', () => {
    expect(Number.isNaN(startOfMoscowYear().getTime())).toBe(false);
  });
});

describe('moscowMonthRange (`Д-22`, прогон №28)', () => {
  it('обычный месяц: от московской полуночи 1-го до 1-го следующего', () => {
    const { from, to } = moscowMonthRange(2026, 9);
    expect(from.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });

  it('декабрь переводит год вперёд, а не в тринадцатый месяц', () => {
    const { from, to } = moscowMonthRange(2026, 12);
    expect(from.toISOString()).toBe('2026-11-30T21:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-31T21:00:00.000Z');
  });

  it('январь: начало года по Москве, а не по UTC', () => {
    expect(moscowMonthRange(2026, 1).from.toISOString()).toBe('2025-12-31T21:00:00.000Z');
  });

  it('однозначные месяцы дополняются нулём — иначе дата не разберётся', () => {
    expect(Number.isNaN(moscowMonthRange(2026, 3).from.getTime())).toBe(false);
  });
});

/**
 * Прогон сопровождения №36 (спека `2026-09-23-moscow-time-in-server-code`,
 * правило 3): день из поля `type="date"` — это МОСКОВСКИЕ сутки, полуоткрыто.
 *
 * Моменты в тестах — те, что реально пишет база: `createdAt` — `now()` сервера,
 * то есть мгновение; поле формы отдаёт «ГГГГ-ММ-ДД». Опасное окно — с 00:00 до
 * 03:00 по Москве (21:00–24:00 по Гринвичу): там московский и гринвичский день
 * расходятся.
 */
describe('moscowCalendarDay (прогон №36)', () => {
  it('в 01:30 МСК день уже сегодняшний, хотя по Гринвичу ещё вчера', () => {
    // 2026-09-03T22:30Z — это 04.09 01:30 МСК; `toISOString().slice(0, 10)` дал бы 09-03.
    expect(moscowCalendarDay(new Date('2026-09-03T22:30:00Z'))).toBe('2026-09-04');
  });

  it('в 23:59 МСК день ещё прежний', () => {
    expect(moscowCalendarDay(new Date('2026-09-04T20:59:00Z'))).toBe('2026-09-04');
  });

  it('1 января в 00:30 МСК — уже новый год', () => {
    expect(moscowCalendarDay(new Date('2025-12-31T21:30:00Z'))).toBe('2026-01-01');
  });
});

describe('moscowYearMonth (прогон №36)', () => {
  it('1 сентября в 01:30 МСК — это сентябрь, а не август', () => {
    expect(moscowYearMonth(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
  });
});

describe('moscowDayRange (прогон №36)', () => {
  it('сутки — от московской полуночи до московской полуночи следующего дня', () => {
    const range = moscowDayRange('2026-08-31');
    expect(range?.gte.toISOString()).toBe('2026-08-30T21:00:00.000Z');
    expect(range?.lt.toISOString()).toBe('2026-08-31T21:00:00.000Z');
  });

  it('запись в 23:30 МСК последнего дня внутри, в 00:30 МСК следующего — нет', () => {
    const range = moscowDayRange('2026-08-31');
    const lateEvening = new Date('2026-08-31T20:30:00Z'); // 31.08 23:30 МСК
    const nextNight = new Date('2026-08-31T21:30:00Z'); // 01.09 00:30 МСК
    const earlyNight = new Date('2026-08-30T21:30:00Z'); // 31.08 00:30 МСК
    expect(range && lateEvening >= range.gte && lateEvening < range.lt).toBe(true);
    expect(range && earlyNight >= range.gte && earlyNight < range.lt).toBe(true);
    expect(range && nextNight < range.lt).toBe(false);
  });

  it('31 декабря: верх — полночь 1 января по Москве', () => {
    expect(moscowDayRange('2026-12-31')?.lt.toISOString()).toBe('2026-12-31T21:00:00.000Z');
  });

  it('пробелы по краям не мешают', () => {
    expect(moscowDayRange(' 2026-08-31 ')?.gte.toISOString()).toBe('2026-08-30T21:00:00.000Z');
  });

  it('несуществующий день и мусор — null, а не «переехавшая» дата', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '31.08.2026', 'вчера', '']) {
      expect(moscowDayRange(bad), bad).toBeNull();
    }
  });
});

describe('moscowRangeFilter (прогон №36)', () => {
  it('«с Д по Д» — московские сутки целиком, верх через lt', () => {
    expect(moscowRangeFilter('2026-08-01', '2026-08-31')).toEqual({
      gte: new Date('2026-07-31T21:00:00.000Z'),
      lt: new Date('2026-08-31T21:00:00.000Z'),
    });
  });

  it('только «с» или только «по» — вторая граница не появляется', () => {
    expect(moscowRangeFilter('2026-08-01', undefined)).toEqual({
      gte: new Date('2026-07-31T21:00:00.000Z'),
    });
    expect(moscowRangeFilter(undefined, '2026-08-31')).toEqual({
      lt: new Date('2026-08-31T21:00:00.000Z'),
    });
  });

  it('пустые и кривые поля — «без границы», как и раньше', () => {
    expect(moscowRangeFilter(undefined, undefined)).toEqual({});
    expect(moscowRangeFilter('', '')).toEqual({});
    expect(moscowRangeFilter('кривая', '2026-02-30')).toEqual({});
  });
});

describe('moscowYearRange (прогон №36)', () => {
  it('год — от 1 января 00:00 МСК до 1 января следующего 00:00 МСК', () => {
    expect(moscowYearRange(2026)).toEqual({
      gte: new Date('2025-12-31T21:00:00.000Z'),
      lt: new Date('2026-12-31T21:00:00.000Z'),
    });
  });

  it('документ 1 января в 01:30 МСК — в новом году, 31 декабря в 23:30 МСК — в старом', () => {
    const { gte, lt } = moscowYearRange(2026);
    const newYearNight = new Date('2025-12-31T22:30:00Z'); // 01.01.2026 01:30 МСК
    const lastEvening = new Date('2026-12-31T20:30:00Z'); // 31.12.2026 23:30 МСК
    const nextYearNight = new Date('2026-12-31T21:30:00Z'); // 01.01.2027 00:30 МСК
    expect(newYearNight >= gte && newYearNight < lt).toBe(true);
    expect(lastEvening >= gte && lastEvening < lt).toBe(true);
    expect(nextYearNight < lt).toBe(false);
  });
});
