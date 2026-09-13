import { describe, expect, it } from 'vitest';

import { inCreatedRange } from '@/lib/services/bitrix/filter';

/**
 * Этап 2 ТЗ 12.09.2026 (`У-200`): период пакета для источников без серверной
 * фильтрации (`fake` и `file`). Считаем на клиенте ровно то, что REST-источник
 * просит у портала.
 */

const FROM = new Date('2025-11-01T00:00:00Z');
const TO = new Date('2025-11-30T23:59:59Z');

describe('inCreatedRange — запись попала в период пакета', () => {
  it('запись без даты создания проходит всегда', () => {
    // Лучше показать лишнее в предпросмотре, чем молча потерять строку.
    expect(inCreatedRange(null, {})).toBe(true);
    expect(inCreatedRange(null, { from: FROM, to: TO })).toBe(true);
  });

  it('без границ период не ограничен — проходит любая дата', () => {
    expect(inCreatedRange(new Date('2001-01-01T00:00:00Z'), {})).toBe(true);
    expect(inCreatedRange(new Date('2099-01-01T00:00:00Z'), {})).toBe(true);
    // Переключатель «только открытые» периода не касается.
    expect(inCreatedRange(new Date('2001-01-01T00:00:00Z'), { openOnly: true })).toBe(true);
  });

  describe('нижняя граница «с»', () => {
    it('дата раньше «с» не проходит', () => {
      expect(inCreatedRange(new Date('2025-10-31T23:59:59Z'), { from: FROM })).toBe(false);
    });

    it('ровно «с» проходит — граница включительная', () => {
      expect(inCreatedRange(new Date('2025-11-01T00:00:00Z'), { from: FROM })).toBe(true);
    });

    it('дата позже «с» проходит', () => {
      expect(inCreatedRange(new Date('2025-11-15T12:00:00Z'), { from: FROM })).toBe(true);
    });
  });

  describe('верхняя граница «по»', () => {
    it('дата позже «по» не проходит', () => {
      expect(inCreatedRange(new Date('2025-12-01T00:00:00Z'), { to: TO })).toBe(false);
    });

    it('ровно «по» проходит — граница включительная', () => {
      expect(inCreatedRange(new Date('2025-11-30T23:59:59Z'), { to: TO })).toBe(true);
    });

    it('дата раньше «по» проходит', () => {
      expect(inCreatedRange(new Date('2025-11-15T12:00:00Z'), { to: TO })).toBe(true);
    });
  });

  describe('обе границы сразу', () => {
    it('внутри периода — проходит, снаружи с любой стороны — нет', () => {
      expect(inCreatedRange(new Date('2025-11-15T12:00:00Z'), { from: FROM, to: TO })).toBe(true);
      expect(inCreatedRange(new Date('2025-10-15T12:00:00Z'), { from: FROM, to: TO })).toBe(false);
      expect(inCreatedRange(new Date('2025-12-15T12:00:00Z'), { from: FROM, to: TO })).toBe(false);
    });

    it('обе границы включительно — крайние дни периода внутри', () => {
      expect(inCreatedRange(FROM, { from: FROM, to: TO })).toBe(true);
      expect(inCreatedRange(TO, { from: FROM, to: TO })).toBe(true);
    });

    it('явный undefined в границе — это «границы нет», а не «не проходит»', () => {
      expect(
        inCreatedRange(new Date('2001-01-01T00:00:00Z'), { from: undefined, to: undefined })
      ).toBe(true);
    });
  });
});
