import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isFeatureEnabled,
  requireFeature,
  notFoundIfDisabled,
  FeatureDisabledError,
  FEATURE_FLAGS,
} from '@/lib/featureFlags';

const ORIGINAL_ENV = { ...process.env };

function clearAllFeatureEnvs() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('FEATURE_')) delete process.env[key];
  }
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearAllFeatureEnvs();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// Opt-in flags invert the default and have separate coverage below.
const OPT_IN_FLAGS = new Set([
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  'chat',
  'enrollment_requests',
  'max_channel',
  'whatsapp_channel',
  'notif_queue',
  'role_constructor',
  'sales_funnel',
  'internal_tasks',
]);

describe('isFeatureEnabled', () => {
  it('returns true when the env var is unset (default-enabled opt-out flags)', () => {
    for (const flag of FEATURE_FLAGS) {
      if (OPT_IN_FLAGS.has(flag)) continue;
      expect(isFeatureEnabled(flag)).toBe(true);
    }
  });

  it('returns true when the env var is empty string', () => {
    process.env.FEATURE_PARTNER_LEADS = '';
    expect(isFeatureEnabled('partner_leads')).toBe(true);
  });

  it.each(['0', 'false', 'off', 'no', 'disabled', 'False', 'OFF', ' 0 '])(
    'returns false for falsy value %s',
    (val) => {
      process.env.FEATURE_PARTNER_LEADS = val;
      expect(isFeatureEnabled('partner_leads')).toBe(false);
    },
  );

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'anything-else'])(
    'returns true for truthy / unknown value %s',
    (val) => {
      process.env.FEATURE_PARTNER_LEADS = val;
      expect(isFeatureEnabled('partner_leads')).toBe(true);
    },
  );

  it('reads each flag from its own dedicated env key', () => {
    process.env.FEATURE_COMMISSION_PDF = '0';
    expect(isFeatureEnabled('commission_pdf')).toBe(false);
    // other flags untouched
    expect(isFeatureEnabled('commission_xlsx')).toBe(true);
    expect(isFeatureEnabled('partner_leads')).toBe(true);
  });

  it('reflects runtime env mutations (re-reads on every call)', () => {
    expect(isFeatureEnabled('partner_leads')).toBe(true);
    process.env.FEATURE_PARTNER_LEADS = '0';
    expect(isFeatureEnabled('partner_leads')).toBe(false);
    delete process.env.FEATURE_PARTNER_LEADS;
    expect(isFeatureEnabled('partner_leads')).toBe(true);
  });
});

describe('requireFeature', () => {
  it('returns silently when enabled', () => {
    expect(() => requireFeature('partner_leads')).not.toThrow();
  });

  it('throws FeatureDisabledError when disabled, carrying the flag name', () => {
    process.env.FEATURE_PARTNER_LEADS = '0';
    let err: unknown;
    try {
      requireFeature('partner_leads');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as FeatureDisabledError).flag).toBe('partner_leads');
    expect((err as Error).message).toContain('partner_leads');
  });
});

describe('notFoundIfDisabled', () => {
  it('returns null when the flag is enabled', () => {
    expect(notFoundIfDisabled('partner_leads')).toBeNull();
  });

  it('returns a 404 Response when disabled', async () => {
    process.env.FEATURE_PARTNER_LEADS = 'off';
    const res = notFoundIfDisabled('partner_leads');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.text()).toBe('Not Found');
  });
});
