import { describe, it, expect } from 'vitest';
import {
  moscowMonthRange,
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
