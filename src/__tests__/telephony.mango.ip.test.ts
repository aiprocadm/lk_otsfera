import { describe, it, expect } from 'vitest';
import { isMangoIpAllowed, clientIpFrom } from '@/lib/telephony/mango/ip';

describe('isMangoIpAllowed', () => {
  it('accepts the 3 default Mango IPs', () => {
    expect(isMangoIpAllowed('81.88.80.132')).toBe(true);
    expect(isMangoIpAllowed('81.88.80.133')).toBe(true);
    expect(isMangoIpAllowed('81.88.82.36')).toBe(true);
  });

  it('rejects an IP not in the default allowlist', () => {
    expect(isMangoIpAllowed('1.2.3.4')).toBe(false);
  });

  it('tolerates a nullish ip (defensive ?? — denied)', () => {
    expect(isMangoIpAllowed(null as never)).toBe(false);
    expect(isMangoIpAllowed(undefined as never)).toBe(false);
  });

  it('restricts to an override allowlist string', () => {
    const override = '9.9.9.9';
    expect(isMangoIpAllowed('9.9.9.9', override)).toBe(true);
    expect(isMangoIpAllowed('81.88.80.132', override)).toBe(false);
  });
});

describe('clientIpFrom', () => {
  it('extracts the first hop of x-forwarded-for', () => {
    const headers = new Headers({ 'x-forwarded-for': '5.6.7.8, 9.9.9.9' });
    expect(clientIpFrom(headers)).toBe('5.6.7.8');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    const headers = new Headers({ 'x-real-ip': '10.10.10.10' });
    expect(clientIpFrom(headers)).toBe('10.10.10.10');
  });

  it('returns empty string when both headers are missing (denied)', () => {
    const headers = new Headers();
    expect(clientIpFrom(headers)).toBe('');
  });
});
