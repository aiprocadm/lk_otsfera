import { describe, it, expect } from 'vitest';
import { errorMessageRu } from '@/lib/errors/messages';
describe('errorMessageRu', () => {
  it('maps known stable codes to Russian strings', () => {
    expect(errorMessageRu('too_large')).toBe('Файл превышает 20 МБ.');
    expect(errorMessageRu('forbidden')).toBe('Нет прав на загрузку.');
    expect(errorMessageRu('invalid_recipient')).toContain('партнёр');
  });
  it('returns the default fallback for an unknown code', () => {
    expect(errorMessageRu('totally_unknown_code')).toBe('Произошла ошибка.');
  });
  it('returns a caller-supplied fallback when given', () => {
    expect(errorMessageRu('totally_unknown_code', 'Ошибка загрузки.')).toBe('Ошибка загрузки.');
  });
});
