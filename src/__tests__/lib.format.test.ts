import { describe, it, expect } from 'vitest';
import { fmtMoney, fmtDate, fmtDateTime } from '@/lib/format';

describe('fmtMoney', () => {
  it('форматирует число с пробелами-разделителями и ₽', () => {
    expect(fmtMoney(250000)).toBe('250 000 ₽');
  });
  it('принимает строку (Decimal сериализуется строкой)', () => {
    expect(fmtMoney('100000.00')).toBe('100 000 ₽');
  });
  it('округляет копейки', () => {
    expect(fmtMoney('99.99')).toBe('100 ₽');
  });
  it('нечисло -> —', () => {
    expect(fmtMoney('abc')).toBe('—');
  });
});

describe('fmtDate', () => {
  it('dd.mm.yyyy', () => {
    expect(fmtDate(new Date('2026-04-20T17:00:00Z'))).toBe('20.04.2026');
  });
  it('невалидная дата -> —', () => {
    expect(fmtDate(new Date('invalid'))).toBe('—');
  });
});

describe('fmtDateTime', () => {
  it('dd.mm.yyyy, hh:mm', () => {
    expect(fmtDateTime(new Date(2026, 3, 20, 17, 5))).toBe('20.04.2026, 17:05');
  });
});
