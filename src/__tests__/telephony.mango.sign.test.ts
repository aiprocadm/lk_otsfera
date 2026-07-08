import { describe, it, expect } from 'vitest';
import { computeMangoSign, verifyMangoSign } from '@/lib/telephony/mango/sign';

describe('computeMangoSign', () => {
  it('returns a 64-char hex sha256 digest', () => {
    const sign = computeMangoSign('KEY', '{"a":1}', 'SALT');
    expect(sign).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = computeMangoSign('KEY', '{"a":1}', 'SALT');
    const b = computeMangoSign('KEY', '{"a":1}', 'SALT');
    expect(a).toBe(b);
  });
});

describe('verifyMangoSign', () => {
  const apiKey = 'KEY';
  const salt = 'SALT';
  const json = '{"a":1}';

  it('true for the correct sign', () => {
    const sign = computeMangoSign(apiKey, json, salt);
    expect(verifyMangoSign({ apiKey, salt, json, sign })).toBe(true);
  });

  it('false for a wrong sign of the same length', () => {
    const sign = computeMangoSign(apiKey, json, salt);
    const wrong = sign.slice(0, -1) + (sign.endsWith('a') ? 'b' : 'a');
    expect(verifyMangoSign({ apiKey, salt, json, sign: wrong })).toBe(false);
  });

  it('false for an empty sign', () => {
    expect(verifyMangoSign({ apiKey, salt, json, sign: '' })).toBe(false);
  });

  it('false for an undefined sign', () => {
    expect(verifyMangoSign({ apiKey, salt, json, sign: undefined as unknown as string })).toBe(false);
  });

  it('false for a length-mismatched (short) sign — must not throw', () => {
    expect(() => verifyMangoSign({ apiKey, salt, json, sign: 'deadbeef' })).not.toThrow();
    expect(verifyMangoSign({ apiKey, salt, json, sign: 'deadbeef' })).toBe(false);
  });
});
