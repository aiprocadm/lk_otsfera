import { describe, it, expect } from 'vitest';
import {
  nextOccurrence,
  parseRecurrence,
  describeRecurrenceRu,
  type RecurrenceRule,
} from '@/lib/tasks/recurrence';

/**
 * Повторяющиеся задачи (`У-221`) — расчёт следующего срока.
 *
 * Здесь проверяется именно арифметика: база и очередь ни при чём. Краевые
 * случаи выбраны по прошлым дефектам проекта — «31 февраля» (`parseIsoCalendarDate`)
 * и «сутки по UTC вместо московских» (`Д-22`).
 */

const msk = (iso: string): Date => new Date(`${iso}+03:00`);
const rule = (r: Partial<RecurrenceRule> & { freq: RecurrenceRule['freq'] }): RecurrenceRule => ({
  interval: 1,
  ...r,
});

describe('nextOccurrence', () => {
  it('каждый день — плюс сутки, время суток сохраняется', () => {
    const next = nextOccurrence(rule({ freq: 'daily' }), msk('2026-09-16T18:00:00'));
    expect(next?.toISOString()).toBe(msk('2026-09-17T18:00:00').toISOString());
  });

  it('каждые три дня — плюс трое суток', () => {
    const next = nextOccurrence(rule({ freq: 'daily', interval: 3 }), msk('2026-09-16T09:00:00'));
    expect(next?.toISOString()).toBe(msk('2026-09-19T09:00:00').toISOString());
  });

  it('через конец месяца переносится правильно', () => {
    const next = nextOccurrence(rule({ freq: 'daily' }), msk('2026-09-30T12:00:00'));
    expect(next?.toISOString()).toBe(msk('2026-10-01T12:00:00').toISOString());
  });

  it('каждую неделю — плюс семь дней, день недели тот же', () => {
    const from = msk('2026-09-16T10:00:00'); // среда
    const next = nextOccurrence(rule({ freq: 'weekly' }), from);
    expect(next?.toISOString()).toBe(msk('2026-09-23T10:00:00').toISOString());
  });

  it('НОЧНАЯ задача не уезжает на день: считаем по московскому календарю', () => {
    // 01:00 МСК среды — это 22:00 UTC вторника. По UTC «плюс неделю» дало бы
    // вторник, и еженедельная задача сползала бы назад. Тот же дефект уже
    // ловили у «Моего дня» (`Д-22`).
    const from = msk('2026-09-16T01:00:00');
    const next = nextOccurrence(rule({ freq: 'weekly' }), from);
    expect(next?.toISOString()).toBe(msk('2026-09-23T01:00:00').toISOString());
  });

  it('по дням недели — ближайший следующий из списка', () => {
    // Среда (3); список — понедельник и пятница.
    const from = msk('2026-09-16T10:00:00');
    const next = nextOccurrence(rule({ freq: 'weekly', byWeekday: [1, 5] }), from);
    expect(next?.toISOString()).toBe(msk('2026-09-18T10:00:00').toISOString()); // пятница
  });

  it('по дням недели — если на этой неделе больше нет, берём первый на следующей', () => {
    const from = msk('2026-09-18T10:00:00'); // пятница
    const next = nextOccurrence(rule({ freq: 'weekly', byWeekday: [1, 5] }), from);
    expect(next?.toISOString()).toBe(msk('2026-09-21T10:00:00').toISOString()); // понедельник
  });

  it('каждый месяц — то же число', () => {
    const next = nextOccurrence(rule({ freq: 'monthly' }), msk('2026-09-10T12:00:00'));
    expect(next?.toISOString()).toBe(msk('2026-10-10T12:00:00').toISOString());
  });

  it('31-е в коротком месяце — ПОСЛЕДНЕЕ число, а не переезд на следующий', () => {
    // JavaScript сам превратил бы 31 ноября в 1 декабря, и задача «31-го числа»
    // молча уехала бы в другой месяц.
    const next = nextOccurrence(rule({ freq: 'monthly' }), msk('2026-10-31T12:00:00'));
    expect(next?.toISOString()).toBe(msk('2026-11-30T12:00:00').toISOString());
  });

  it('февраль високосного года тоже считается честно', () => {
    const next = nextOccurrence(
      rule({ freq: 'monthly', byMonthDay: 31 }),
      msk('2028-01-31T12:00:00')
    );
    expect(next?.toISOString()).toBe(msk('2028-02-29T12:00:00').toISOString());
  });

  it('декабрь → январь следующего года', () => {
    const next = nextOccurrence(rule({ freq: 'monthly' }), msk('2026-12-15T12:00:00'));
    expect(next?.toISOString()).toBe(msk('2027-01-15T12:00:00').toISOString());
  });

  it('`until` в прошлом завершает серию БЕЗ ошибки', () => {
    const next = nextOccurrence(
      rule({ freq: 'weekly', until: '2026-09-20' }),
      msk('2026-09-16T10:00:00')
    );
    expect(next).toBeNull();
  });

  it('последний день `until` включается в серию целиком', () => {
    // Срок 23 сентября 18:00 при `until = 2026-09-23` обязан попасть в серию:
    // человек задал ДАТУ, а не момент, и «до 23-го» значит «включая 23-е».
    const next = nextOccurrence(
      rule({ freq: 'weekly', until: '2026-09-23' }),
      msk('2026-09-16T18:00:00')
    );
    expect(next?.toISOString()).toBe(msk('2026-09-23T18:00:00').toISOString());
  });
});

describe('parseRecurrence', () => {
  it('разбирает правило из базы', () => {
    expect(parseRecurrence({ freq: 'weekly', interval: 2 })).toEqual({
      freq: 'weekly',
      interval: 2,
    });
  });

  it('мусор и пустоту превращает в «нет правила», а не роняет экран', () => {
    for (const bad of [
      null,
      undefined,
      {},
      { freq: 'yearly', interval: 1 },
      { freq: 'daily' },
      'нет',
      5,
    ]) {
      expect(parseRecurrence(bad)).toBeNull();
    }
  });

  it('невозможные значения не проходят', () => {
    expect(parseRecurrence({ freq: 'daily', interval: 0 })).toBeNull();
    expect(parseRecurrence({ freq: 'daily', interval: 400 })).toBeNull();
    expect(parseRecurrence({ freq: 'monthly', interval: 1, byMonthDay: 32 })).toBeNull();
    expect(parseRecurrence({ freq: 'weekly', interval: 1, byWeekday: [7] })).toBeNull();
    expect(parseRecurrence({ freq: 'daily', interval: 1, until: '16.09.2026' })).toBeNull();
  });
});

describe('describeRecurrenceRu', () => {
  it('единица — без числа и в правильном роде', () => {
    expect(describeRecurrenceRu(rule({ freq: 'daily' }))).toBe('Каждый день');
    expect(describeRecurrenceRu(rule({ freq: 'weekly' }))).toBe('Каждую неделю');
    expect(describeRecurrenceRu(rule({ freq: 'monthly' }))).toBe('Каждый месяц');
  });

  it('склонение по-русски: 2 недели, 5 недель, 11 недель', () => {
    expect(describeRecurrenceRu(rule({ freq: 'weekly', interval: 2 }))).toBe('Каждые 2 недели');
    expect(describeRecurrenceRu(rule({ freq: 'weekly', interval: 5 }))).toBe('Каждые 5 недель');
    expect(describeRecurrenceRu(rule({ freq: 'weekly', interval: 11 }))).toBe('Каждые 11 недель');
    expect(describeRecurrenceRu(rule({ freq: 'daily', interval: 21 }))).toBe('Каждые 21 день');
  });

  it('дата окончания показывается по-человечески', () => {
    expect(describeRecurrenceRu(rule({ freq: 'monthly', until: '2026-12-31' }))).toBe(
      'Каждый месяц, до 31.12.2026'
    );
  });
});
