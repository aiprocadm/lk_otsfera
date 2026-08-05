import { describe, it, expect } from 'vitest';
import { normalizeInn } from '@/lib/services/oneCSync/inn';

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
