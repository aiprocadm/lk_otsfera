import { describe, it, expect, afterEach } from 'vitest';
import { isFeatureEnabled } from '@/lib/featureFlags';

describe('chat feature flag', () => {
  const KEY = 'FEATURE_CHAT';
  afterEach(() => {
    delete process.env[KEY];
  });

  it('включён по умолчанию (прогон №37: готовая функция, нужна одна база)', () => {
    delete process.env[KEY];
    expect(isFeatureEnabled('chat')).toBe(true);
  });
  it('FEATURE_CHAT=0 выключает — флаг остался аварийным тормозом', () => {
    process.env[KEY] = '0';
    expect(isFeatureEnabled('chat')).toBe(false);
  });
  it('turns on with truthy env', () => {
    process.env[KEY] = '1';
    expect(isFeatureEnabled('chat')).toBe(true);
  });
});
