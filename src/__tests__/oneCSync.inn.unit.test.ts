import { describe, it, expect } from 'vitest';
import { normalizeInn, isValidInn, synthOrgExternalId } from '@/lib/services/oneCSync/inn';

/**
 * Т-20 (этап 4): минимальная нормализация ИНН — пробелы, включая неразрывные.
 * Этап 5 (Т-22) расширит эту же функцию числом→строкой и ведущими нулями.
 */
describe('normalizeInn', () => {
  it('убирает обычные и неразрывные пробелы', () => {
    expect(normalizeInn(' 7712345678 ')).toBe('7712345678');
    expect(normalizeInn('7712 345 678')).toBe('7712345678');
  });

  it('цифры не искажает', () => {
    expect(normalizeInn('7712345678')).toBe('7712345678');
  });

  it('не-цифровые строки (slug сетевого обмена) проходят без потерь смысла', () => {
    // slug в OR-запросе идёт сырым, но и через normalizeInn он не должен ломаться.
    expect(normalizeInn('acme-partner')).toBe('acme-partner');
  });
});

describe('normalizeInn — ведущие нули (Т-22, этап 5)', () => {
  it('число из Excel без ведущих нулей дополняется до 10 знаков (юрлицо)', () => {
    expect(normalizeInn('12345678')).toBe('0012345678');
  });

  it('11 цифр дополняются до 12 (физлицо/ИП)', () => {
    expect(normalizeInn('12345678901')).toBe('012345678901');
  });

  it('10 и 12 знаков не трогаются', () => {
    expect(normalizeInn('7707083893')).toBe('7707083893');
    expect(normalizeInn('500100732259')).toBe('500100732259');
  });

  it('слишком длинная строка цифр не дополняется (валидация её отвергнет)', () => {
    expect(normalizeInn('1234567890123')).toBe('1234567890123');
  });
});

describe('isValidInn — контрольная сумма (Т-21)', () => {
  it('валидные ИНН 10 и 12 знаков проходят', () => {
    expect(isValidInn('7707083893')).toBe(true);
    expect(isValidInn('500100732259')).toBe(true);
  });

  it('битая контрольная цифра отвергается', () => {
    expect(isValidInn('7707083894')).toBe(false);
    expect(isValidInn('500100732258')).toBe(false);
  });

  it('неверная длина и мусор отвергаются', () => {
    expect(isValidInn('123')).toBe(false);
    expect(isValidInn('12345678901')).toBe(false);
    expect(isValidInn('abcdefghij')).toBe(false);
    expect(isValidInn('')).toBe(false);
  });
});

describe('synthOrgExternalId (Т-16)', () => {
  it('стабилен: один ИНН → один ключ, с обязательным префиксом', () => {
    expect(synthOrgExternalId('7707083893')).toBe('1c-inn:7707083893');
    expect(synthOrgExternalId(' 7707 083893 ')).toBe('1c-inn:7707083893');
  });

  it('нормализует внутри себя — ведущие нули не теряются', () => {
    expect(synthOrgExternalId('12345678')).toBe('1c-inn:0012345678');
  });
});
