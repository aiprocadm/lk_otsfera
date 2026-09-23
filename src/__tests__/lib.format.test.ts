import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fmtMoney,
  fmtDate,
  fmtDateTime,
  fmtLastLogin,
  fmtMonthPeriod,
  pluralizeRu,
} from '@/lib/format';

describe('fmtMoney', () => {
  it('форматирует число с пробелами-разделителями и ₽', () => {
    expect(fmtMoney(250000)).toBe('250 000 ₽'); // разделитель тысяч — U+00A0 (NBSP), не обычный пробел
  });
  it('принимает строку (Decimal сериализуется строкой)', () => {
    expect(fmtMoney('100000.00')).toBe('100 000 ₽'); // разделитель тысяч — U+00A0 (NBSP), не обычный пробел
  });
  it('округляет копейки', () => {
    expect(fmtMoney('99.99')).toBe('100 ₽');
  });
  it('нечисло -> —', () => {
    expect(fmtMoney('abc')).toBe('—');
  });
  it('Infinity -> —', () => {
    expect(fmtMoney(Infinity)).toBe('—');
  });
  it('-Infinity -> —', () => {
    expect(fmtMoney(-Infinity)).toBe('—');
  });
});

describe('fmtDate', () => {
  it('dd.mm.yyyy', () => {
    expect(fmtDate(new Date('2026-04-20T17:00:00Z'))).toBe('20.04.2026');
  });
  it('невалидная дата -> —', () => {
    expect(fmtDate(new Date('invalid'))).toBe('—');
  });
  it('timezone-детерминизм: 23:30Z = 02:30 МСК следующего дня', () => {
    // 23:30Z = 02:30 МСК следующего дня — проверяет пиновку Europe/Moscow
    expect(fmtDate(new Date('2026-04-20T23:30:00Z'))).toBe('21.04.2026');
  });
  it('date-only ISO парсится как UTC midnight = 03:00 МСК того же дня', () => {
    expect(fmtDate('2026-04-20')).toBe('20.04.2026');
  });
});

describe('fmtDateTime', () => {
  it('dd.mm.yyyy, hh:mm (TZ-независимая форма)', () => {
    // new Date('2026-04-20T14:05:00Z') = 14:05Z = 17:05 МСК
    expect(fmtDateTime(new Date('2026-04-20T14:05:00Z'))).toBe('20.04.2026, 17:05');
  });

  it('принимает строку ISO и форматирует в МСК', () => {
    expect(fmtDateTime('2026-04-20T14:05:00Z')).toBe('20.04.2026, 17:05');
  });

  it('невалидная строка -> —', () => {
    expect(fmtDateTime('not-a-date')).toBe('—');
  });

  it('невалидный Date -> —', () => {
    expect(fmtDateTime(new Date('invalid'))).toBe('—');
  });
});

describe('fmtDate — дополнительные ветки', () => {
  it('принимает строку ISO и форматирует в МСК', () => {
    expect(fmtDate('2026-04-20T17:00:00Z')).toBe('20.04.2026');
  });
});

/**
 * Этап 9 (ФТ-11.3): «Последний вход» в списках пользователей.
 * Часы пинуем через `vi.setSystemTime`, иначе «сегодня/не сегодня» плавает
 * от даты прогона, а календарный день считается по Москве, а не по TZ CI.
 */
describe('fmtLastLogin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('null -> — (ещё ни разу не входил)', () => {
    expect(fmtLastLogin(null)).toBe('—');
  });

  it('undefined -> — (поле не пришло в выборке)', () => {
    expect(fmtLastLogin(undefined)).toBe('—');
  });

  it('мусорная строка -> —', () => {
    expect(fmtLastLogin('не дата')).toBe('—');
  });

  it('невалидный Date -> —', () => {
    expect(fmtLastLogin(new Date('invalid'))).toBe('—');
  });

  it('вход прямо сейчас -> «сегодня, HH:mm» (на реальных часах, без пиновки)', () => {
    expect(fmtLastLogin(new Date())).toMatch(/^сегодня, \d{2}:\d{2}$/);
  });

  it('сегодняшний вход: время печатается московское, а не UTC', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T12:00:00Z')); // «сейчас» = 15:00 МСК 27 июля
    expect(fmtLastLogin(new Date('2026-07-27T09:30:00Z'))).toBe('сегодня, 12:30');
  });

  it('вчерашний вход -> dd.mm.yyyy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T09:00:00Z'));
    expect(fmtLastLogin(new Date('2026-07-12T10:00:00Z'))).toBe('12.07.2026');
  });

  it('старый вход строкой ISO -> dd.mm.yyyy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-27T09:00:00Z'));
    expect(fmtLastLogin('2026-07-12T10:00:00Z')).toBe('12.07.2026');
  });

  it('«сегодня» считается по московскому дню, а не по UTC-дню', () => {
    vi.useFakeTimers();
    // «сейчас» = 23:30Z 27 июля = 02:30 МСК уже 28 июля.
    vi.setSystemTime(new Date('2026-07-27T23:30:00Z'));
    // 23:00Z 27 июля = 02:00 МСК 28 июля — тот же московский день, что и «сейчас».
    expect(fmtLastLogin(new Date('2026-07-27T23:00:00Z'))).toBe('сегодня, 02:00');
    // 20:00Z 27 июля = 23:00 МСК 27 июля — по Москве это уже вчера, хотя UTC-день тот же.
    expect(fmtLastLogin(new Date('2026-07-27T20:00:00Z'))).toBe('27.07.2026');
  });
});

describe('pluralizeRu', () => {
  it('1, 21 -> one (но не 11)', () => {
    expect(pluralizeRu(1, 'заказ', 'заказа', 'заказов')).toBe('заказ');
    expect(pluralizeRu(21, 'заказ', 'заказа', 'заказов')).toBe('заказ');
  });
  it('2-4, 22-24 -> few (но не 12-14)', () => {
    expect(pluralizeRu(2, 'заказ', 'заказа', 'заказов')).toBe('заказа');
    expect(pluralizeRu(24, 'заказ', 'заказа', 'заказов')).toBe('заказа');
  });
  it('0, 5, 11, 12, 14 -> many', () => {
    expect(pluralizeRu(0, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(5, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(11, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(12, 'заказ', 'заказа', 'заказов')).toBe('заказов');
    expect(pluralizeRu(14, 'заказ', 'заказа', 'заказов')).toBe('заказов');
  });
});

/**
 * Прогон сопровождения №36, группа Б спеки `2026-09-23-moscow-time-in-server-code`.
 *
 * Границы — ровно те, что пишет расчёт ведомости
 * (`worker/processors/calculate-monthly-commissions.ts`): начало — московская
 * полночь 1-го (`startOfMoscowMonth`), конец — миг до московской полуночи
 * 1-го следующего месяца. По часам процесса (UTC) начало августа — это ещё
 * 31 июля: пять прежних копий подписи печатали «31.07.2026 — 31.08.2026».
 */
describe('fmtMonthPeriod', () => {
  const AUG_FROM = new Date('2026-07-31T21:00:00.000Z'); // 01.08.2026 00:00 МСК
  const AUG_TO = new Date('2026-08-31T20:59:59.999Z'); // 31.08.2026 23:59:59.999 МСК

  it('август по московским границам — «август 2026», а не «31.07.2026 — 31.08.2026»', () => {
    expect(fmtMonthPeriod(AUG_FROM, AUG_TO, 'long')).toBe('август 2026');
  });

  it('короткая подпись экранов — «авг 2026»', () => {
    expect(fmtMonthPeriod(AUG_FROM, AUG_TO, 'short')).toBe('авг 2026');
  });

  it('январь — «январь 2026», а не прошлый год', () => {
    // 01.01.2026 00:00 МСК = 31.12.2025 21:00 по Гринвичу: по часам процесса
    // начало периода лежало в декабре 2025.
    const from = new Date('2025-12-31T21:00:00.000Z');
    const to = new Date('2026-01-31T20:59:59.999Z');
    expect(fmtMonthPeriod(from, to, 'long')).toBe('январь 2026');
    expect(fmtMonthPeriod(from, to, 'short')).toBe('янв 2026');
  });

  it('декабрь — последний месяц массива названий', () => {
    const from = new Date('2026-11-30T21:00:00.000Z');
    const to = new Date('2026-12-31T20:59:59.999Z');
    expect(fmtMonthPeriod(from, to, 'long')).toBe('декабрь 2026');
    expect(fmtMonthPeriod(from, to, 'short')).toBe('дек 2026');
  });

  it('строки ISO (так даты приходят через JSON) разбираются так же', () => {
    expect(fmtMonthPeriod(AUG_FROM.toISOString(), AUG_TO.toISOString(), 'long')).toBe(
      'август 2026'
    );
  });

  it('разные московские месяцы — даты по Москве через тире', () => {
    const from = new Date('2026-07-31T21:00:00.000Z'); // 01.08 00:00 МСК
    const to = new Date('2026-09-30T20:59:59.999Z'); // 30.09 23:59 МСК
    expect(fmtMonthPeriod(from, to, 'long')).toBe('01.08.2026 — 30.09.2026');
  });

  it('кривая дата — «—», а не падение страницы', () => {
    expect(fmtMonthPeriod('кривая', AUG_TO, 'short')).toBe('—');
    expect(fmtMonthPeriod(AUG_FROM, new Date('invalid'), 'short')).toBe('—');
  });

  /*
   * Замечание проверки (прогон №36): ведомости, записанные до `Д-22` (воркер
   * до #603) и демо-сидом, лежат в базе с границами месяца по Гринвичу —
   * `new Date(y, m, 1)` … `new Date(y, m + 1, 0, 23, 59, 59, 999)` в процессе
   * с UTC. Ровно такие две строки на стенде приёмки. По Москве их конец —
   * уже 1-е число следующего месяца (02:59), и подпись стала бы диапазоном.
   */
  describe('ведомости с границами месяца по Гринвичу (до Д-22)', () => {
    it('июльская ведомость стенда — «июль 2026», а не «01.07.2026 — 01.08.2026»', () => {
      const from = '2026-07-01T00:00:00.000Z';
      const to = '2026-07-31T23:59:59.999Z'; // 01.08.2026 02:59 МСК
      expect(fmtMonthPeriod(from, to, 'long')).toBe('июль 2026');
      expect(fmtMonthPeriod(from, to, 'short')).toBe('июл 2026');
    });

    it('июньская ведомость стенда — «июн 2026»', () => {
      expect(
        fmtMonthPeriod(
          new Date('2026-06-01T00:00:00.000Z'),
          new Date('2026-06-30T23:59:59.999Z'),
          'short'
        )
      ).toBe('июн 2026');
    });

    it('декабрь по Гринвичу — прошлый год, хотя конец по Москве уже 1 января', () => {
      const from = '2025-12-01T00:00:00.000Z';
      const to = '2025-12-31T23:59:59.999Z'; // 01.01.2026 02:59 МСК
      expect(fmtMonthPeriod(from, to, 'long')).toBe('декабрь 2025');
    });

    it('похожий, но не точный конец — это не след писателя, подпись датами', () => {
      // Конец на секунду раньше последней миллисекунды месяца по Гринвичу.
      const from = '2026-07-01T00:00:00.000Z';
      const to = '2026-07-31T23:59:59.000Z'; // 01.08.2026 02:59 МСК
      expect(fmtMonthPeriod(from, to, 'short')).toBe('01.07.2026 — 01.08.2026');
    });

    it('ручной расчёт за два месяца по Гринвичу — подпись датами', () => {
      const from = '2026-07-01T00:00:00.000Z';
      const to = '2026-08-31T23:59:59.999Z';
      expect(fmtMonthPeriod(from, to, 'short')).toBe('01.07.2026 — 01.09.2026');
    });
  });
});
