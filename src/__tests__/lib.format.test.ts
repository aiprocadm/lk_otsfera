import { describe, it, expect, vi, afterEach } from 'vitest';
import { fmtMoney, fmtDate, fmtDateTime, fmtLastLogin, pluralizeRu } from '@/lib/format';

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