import { describe, it, expect } from 'vitest';
import { orderTypeRu, paymentMethodRu } from '@/lib/i18n/labels';

describe('orderTypeRu', () => {
  it('переводит известные коды', () => {
    expect(orderTypeRu('supply')).toBe('Поставка');
    expect(orderTypeRu('service')).toBe('Услуги');
    expect(orderTypeRu('training')).toBe('Обучение');
  });
  it('неизвестный код показывает как есть (не падает)', () => {
    expect(orderTypeRu('unknown_1c_code')).toBe('unknown_1c_code');
  });
});

describe('paymentMethodRu', () => {
  it('переводит известные коды', () => {
    expect(paymentMethodRu('wire')).toBe('Банковский перевод');
    expect(paymentMethodRu('card')).toBe('Карта');
    expect(paymentMethodRu('cash')).toBe('Наличные');
  });
  it('null/undefined -> —', () => {
    expect(paymentMethodRu(null)).toBe('—');
    expect(paymentMethodRu(undefined)).toBe('—');
  });
  it('неизвестный код как есть', () => {
    expect(paymentMethodRu('crypto')).toBe('crypto');
  });
});
