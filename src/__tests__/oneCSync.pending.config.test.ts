import { describe, it, expect, afterEach } from 'vitest';
import { oneCPendingMaxAttempts, oneCPendingMaxAgeDays } from '@/lib/services/oneCSync/config';

afterEach(() => { delete process.env.ONE_C_PENDING_MAX_ATTEMPTS; delete process.env.ONE_C_PENDING_MAX_AGE_DAYS; });

describe('pending dead-letter config', () => {
  it('defaults: 50 attempts, 7 days', () => {
    expect(oneCPendingMaxAttempts()).toBe(50);
    expect(oneCPendingMaxAgeDays()).toBe(7);
  });
  it('reads overrides from env', () => {
    process.env.ONE_C_PENDING_MAX_ATTEMPTS = '10';
    process.env.ONE_C_PENDING_MAX_AGE_DAYS = '3';
    expect(oneCPendingMaxAttempts()).toBe(10);
    expect(oneCPendingMaxAgeDays()).toBe(3);
  });
  it('ignores non-positive / non-numeric env and falls back to default', () => {
    process.env.ONE_C_PENDING_MAX_ATTEMPTS = '0';
    process.env.ONE_C_PENDING_MAX_AGE_DAYS = 'abc';
    expect(oneCPendingMaxAttempts()).toBe(50);
    expect(oneCPendingMaxAgeDays()).toBe(7);
  });
});
