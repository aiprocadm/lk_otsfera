import { describe, it, expect } from 'vitest';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';

describe('normalizePhoneCanonical', () => {
  it('canonicalizes RU national 8XXXXXXXXXX (11 digits) → +7XXXXXXXXXX', () => {
    expect(normalizePhoneCanonical('8 (999) 000-11-22')).toBe('+79990001122');
    expect(normalizePhoneCanonical('89990001122')).toBe('+79990001122');
  });
  it('passes through already-canonical +7 numbers, stripping formatting', () => {
    expect(normalizePhoneCanonical('+7 (999) 000-11-22')).toBe('+79990001122');
  });
  it('non-RU / non-11-digit: strip to digits, prefix +', () => {
    expect(normalizePhoneCanonical('+1 202 555 0100')).toBe('+12025550100');
    expect(normalizePhoneCanonical('8005553535')).toBe('+8005553535');
  });
  it('empty / no digits → empty string', () => {
    expect(normalizePhoneCanonical('---')).toBe('');
    expect(normalizePhoneCanonical('')).toBe('');
  });
  it('null/undefined raw input falls back to empty string via `raw ?? \'\'`', () => {
    expect(normalizePhoneCanonical(undefined as unknown as string)).toBe('');
    expect(normalizePhoneCanonical(null as unknown as string)).toBe('');
  });
});
