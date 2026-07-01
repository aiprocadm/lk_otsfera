import { describe, it, expect } from 'vitest';
import { MAX_ORGANIZATION_USERS, MAX_PARTNER_USERS } from '@/lib/config/teamLimits';

describe('team limits (§14 ТЗ)', () => {
  it('organization cap is 10', () => {
    expect(MAX_ORGANIZATION_USERS).toBe(10);
  });
  it('partner cap is 5', () => {
    expect(MAX_PARTNER_USERS).toBe(5);
  });
});
