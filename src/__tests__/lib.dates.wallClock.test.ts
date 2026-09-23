import { describe, expect, it } from 'vitest';
import { parseMoscowWallClock, toMoscowWallClockInput } from '@/lib/dates/wallClock';

/**
 * Прогон сопровождения №36 (спека 2026-09-23-moscow-time-in-server-code-design,
 * §3 п. 5, решение `Р-М-4`): время без пояса — московское «настенное».
 *
 * Процесс теста живёт в UTC, как сервер: именно там `new Date('…T10:00')`
 * давал 10:00 по Гринвичу, то есть 13:00 по Москве. Значения — те, что отдаёт
 * поле `datetime-local` формы календаря и настраиваемого поля.
 */
describe('parseMoscowWallClock', () => {
  it('«10:00» из формы — это 07:00 UTC', () => {
    expect(parseMoscowWallClock('2026-09-25T10:00')?.toISOString()).toBe(
      '2026-09-25T07:00:00.000Z'
    );
  });

  it('ночь с 00:00 до 03:00 по Москве — момент ПРЕДЫДУЩИХ суток по UTC', () => {
    expect(parseMoscowWallClock('2026-09-01T00:00')?.toISOString()).toBe(
      '2026-08-31T21:00:00.000Z'
    );
    expect(parseMoscowWallClock('2026-09-01T02:59')?.toISOString()).toBe(
      '2026-08-31T23:59:00.000Z'
    );
  });

  it('конец московских суток — ещё тот же день по UTC', () => {
    expect(parseMoscowWallClock('2026-08-31T23:59')?.toISOString()).toBe(
      '2026-08-31T20:59:00.000Z'
    );
  });

  it('секунды и доли секунды тоже принимаются', () => {
    expect(parseMoscowWallClock('2026-09-25T10:00:15')?.toISOString()).toBe(
      '2026-09-25T07:00:15.000Z'
    );
    expect(parseMoscowWallClock('2026-09-25T10:00:15.250')?.toISOString()).toBe(
      '2026-09-25T07:00:15.250Z'
    );
  });

  it('несуществующий день → null, а не перенос на март', () => {
    // `new Date('2026-02-30T10:00+03:00')` молча отдал бы 2 марта.
    expect(parseMoscowWallClock('2026-02-30T10:00')).toBeNull();
    expect(parseMoscowWallClock('2025-02-29T10:00')).toBeNull();
    expect(parseMoscowWallClock('2024-02-29T10:00')?.toISOString()).toBe(
      '2024-02-29T07:00:00.000Z'
    );
  });

  it('час 24, минута 60, секунда 60 → null: `Date` перенёс бы их в соседний час', () => {
    expect(parseMoscowWallClock('2026-09-25T24:00')).toBeNull();
    expect(parseMoscowWallClock('2026-09-25T10:60')).toBeNull();
    expect(parseMoscowWallClock('2026-09-25T10:00:60')).toBeNull();
  });

  it('не тот вид строки → null', () => {
    for (const bad of [
      '',
      '2026-09-25',
      '2026-09-25 10:00',
      '2026-09-25T10',
      '2026-09-25T10:00Z',
      '2026-09-25T10:00+03:00',
      ' 2026-09-25T10:00',
      '25.09.2026 10:00',
    ]) {
      expect(parseMoscowWallClock(bad), bad).toBeNull();
    }
  });
});

describe('toMoscowWallClockInput', () => {
  it('момент → «ГГГГ-ММ-ДДTчч:мм» по Москве, секунды отбрасываются', () => {
    expect(toMoscowWallClockInput(new Date('2026-09-25T07:00:45.000Z'))).toBe('2026-09-25T10:00');
  });

  it('21:00–24:00 UTC — это уже следующий московский день', () => {
    expect(toMoscowWallClockInput(new Date('2026-08-31T21:00:00.000Z'))).toBe('2026-09-01T00:00');
    expect(toMoscowWallClockInput(new Date('2026-12-31T22:30:00.000Z'))).toBe('2027-01-01T01:30');
  });

  it('обратная к разбору: что форма показала, то она и сохранит', () => {
    // Шаг 7 минут через трое суток, включая обе ночные границы.
    const start = Date.parse('2026-08-30T18:00:00.000Z');
    for (let ms = start; ms < start + 3 * 24 * 3_600_000; ms += 7 * 60_000) {
      const moment = new Date(ms);
      expect(parseMoscowWallClock(toMoscowWallClockInput(moment))).toEqual(moment);
    }
  });
});
