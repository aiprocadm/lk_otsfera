import { describe, it, expect } from 'vitest';
import { errorMessageRu } from '@/lib/errors/messages';
describe('errorMessageRu', () => {
  it('maps known stable codes to Russian strings', () => {
    expect(errorMessageRu('too_large')).toBe('Файл превышает допустимый размер.');
    expect(errorMessageRu('forbidden')).toBe('Нет прав на загрузку.');
    expect(errorMessageRu('invalid_recipient')).toContain('партнёр');
  });
  it('returns the default fallback for an unknown code', () => {
    expect(errorMessageRu('totally_unknown_code')).toBe('Произошла ошибка.');
  });
  it('returns a caller-supplied fallback when given', () => {
    expect(errorMessageRu('totally_unknown_code', 'Ошибка загрузки.')).toBe('Ошибка загрузки.');
  });
  it('maps the throw→Result migration codes to Russian', () => {
    for (const code of [
      'org_out_of_scope', 'already_rejected', 'already_promoted', 'rate_out_of_range',
      'company_not_found', 'requires_admin', 'already_member', 'last_admin_protected',
      'self_action_forbidden', 'lifecycle_violation'
    ]) {
      expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
    }
  });
});
