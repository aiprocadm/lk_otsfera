import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtDate, fmtDateTime } from '@/lib/format';

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