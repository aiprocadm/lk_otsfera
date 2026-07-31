import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isFeatureEnabled, requireFeature, notFoundIfDisabled } from '@/lib/featureFlags';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.FEATURE_ORGANIZATION_CABINET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('organization_cabinet (opt-in flag)', () => {
  it('is DISABLED when env is unset (opt-in default)', () => {
    expect(isFeatureEnabled('organization_cabinet')).toBe(false);
  });

  it('is DISABLED when env is empty string', () => {
    process.env.FEATURE_ORGANIZATION_CABINET = '';
    expect(isFeatureEnabled('organization_cabinet')).toBe(false);
  });

  it.each(['0', 'false', 'off', 'no', 'disabled'])('stays disabled for falsy value %s', (val) => {
    process.env.FEATURE_ORGANIZATION_CABINET = val;
    expect(isFeatureEnabled('organization_cabinet')).toBe(false);
  });

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'True', ' 1 '])(
    'is ENABLED for truthy value %s',
    (val) => {
      process.env.FEATURE_ORGANIZATION_CABINET = val;
      expect(isFeatureEnabled('organization_cabinet')).toBe(true);
    }
  );

  it('rejects unknown / garbage values (strict opt-in)', () => {
    process.env.FEATURE_ORGANIZATION_CABINET = 'maybe';
    expect(isFeatureEnabled('organization_cabinet')).toBe(false);
  });

  it('requireFeature throws when disabled (default)', () => {
    expect(() => requireFeature('organization_cabinet')).toThrow();
  });

  it('notFoundIfDisabled returns 404 when default-disabled', async () => {
    const res = notFoundIfDisabled('organization_cabinet');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
  });

  it('notFoundIfDisabled returns null when explicitly enabled', () => {
    process.env.FEATURE_ORGANIZATION_CABINET = '1';
    expect(notFoundIfDisabled('organization_cabinet')).toBeNull();
  });
});
