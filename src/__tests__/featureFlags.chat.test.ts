import { describe, it, expect, afterEach } from 'vitest';
import { isFeatureEnabled } from '@/lib/featureFlags';

describe('chat feature flag', () => {
  const KEY = 'FEATURE_CHAT';
  afterEach(() => { delete process.env[KEY]; });

  it('is OFF by default (opt-in)', () => {
    delete process.env[KEY];
    expect(isFeatureEnabled('chat')).toBe(false);
  });
  it('turns on with truthy env', () => {
    process.env[KEY] = '1';
    expect(isFeatureEnabled('chat')).toBe(true);
  });
});
