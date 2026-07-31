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
      'org_out_of_scope',
      'already_rejected',
      'already_promoted',
      'rate_out_of_range',
      'company_not_found',
      'requires_admin',
      'already_member',
      'last_admin_protected',
      'self_action_forbidden',
      'lifecycle_violation',
    ]) {
      expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
    }
  });
  it('maps the throw→Result wave-2 codes to Russian', () => {
    for (const code of [
      'email_taken',
      'org_not_found',
      'user_not_found',
      'role_conflict',
      'already_assigned',
      'invalid_status',
      'partner_not_found',
      'period_overlap',
      'duplicate_slug',
      'duplicate_email',
      'admin_role_via_ui',
      'role_transition_forbidden',
    ]) {
      expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
    }
  });
  it('maps the R2 backlog codes to Russian (36-code inventory)', () => {
    for (const code of [
      'bad_request',
      'invalid_request',
      'order_not_found',
      'invalid_file',
      'parse_failed',
      'empty',
      'infected',
      'queue_unavailable',
      'too_many_requests',
      'invalid_token',
      'invalid_code',
      'chat_taken',
      'thread_not_found',
      'empty_body',
      'reason_required',
      'invalid_transition',
      'invalid_stage',
      'invalid_state',
      'position_taken',
      'duplicate_position',
      'invalid_column',
      'org_required',
      'forbidden_org',
      'name_taken',
      'invalid_manager',
      'not_a_manager',
      'no_company',
      'member_limit_reached',
      'completion_conditions_unmet',
      'student_mismatch',
      'direction_inactive',
      'unknown_entity',
      'unknown_schedule',
      'already_running',
      'write_skipped',
      'invalid_cursor',
    ]) {
      expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
    }
  });
  it('maps the staff-2FA codes to Russian', () => {
    for (const code of [
      'email_send_failed',
      'code_expired',
      'invalid_code',
      'too_many_attempts',
      'session_expired',
    ]) {
      expect(errorMessageRu(code)).not.toBe('Произошла ошибка.');
    }
  });
});
