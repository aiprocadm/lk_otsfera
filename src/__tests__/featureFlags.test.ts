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
  'leader_analytics',
  'internal_tasks',
  'inbound_messaging',
  'telephony_mango',
  'staff_2fa',
  'contacts',
  'staff_chat',
  'staff_calendar',
  'global_search',
  'certificates_registry',
  'client_requests',
  'deals_pipeline',
  'intake_inbox',
  'document_generation',
  'cabinet_questions',
]);

describe('isFeatureEnabled', () => {
  it('returns true when the env var is unset (default-enabled opt-out flags)', () => {
    for (const flag of FEATURE_FLAGS) {
      if (OPT_IN_FLAGS.has(flag)) continue;
      expect(isFeatureEnabled(flag)).toBe(true);
    }
  });

  it('returns true when the env var is empty string', () => {
    process.env.FEATURE_COMMISSION_PDF = '';
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
  });

  it('staff_2fa is opt-in: disabled by default, enabled by FEATURE_STAFF_2FA=1', () => {
    delete process.env.FEATURE_STAFF_2FA;
    expect(isFeatureEnabled('staff_2fa')).toBe(false);
    process.env.FEATURE_STAFF_2FA = '1';
    expect(isFeatureEnabled('staff_2fa')).toBe(true);
  });

  it.each(['0', 'false', 'off', 'no', 'disabled', 'False', 'OFF', ' 0 '])(
    'returns false for falsy value %s',
    (val) => {
      process.env.FEATURE_COMMISSION_PDF = val;
      expect(isFeatureEnabled('commission_pdf')).toBe(false);
    }
  );

  it.each(['1', 'true', 'on', 'yes', 'enabled', 'anything-else'])(
    'returns true for truthy / unknown value %s',
    (val) => {
      process.env.FEATURE_COMMISSION_PDF = val;
      expect(isFeatureEnabled('commission_pdf')).toBe(true);
    }
  );

  it('reads each flag from its own dedicated env key', () => {
    process.env.FEATURE_COMMISSION_PDF = '0';
    expect(isFeatureEnabled('commission_pdf')).toBe(false);
    // other flags untouched
    expect(isFeatureEnabled('commission_xlsx')).toBe(true);
    expect(isFeatureEnabled('pwa_installer')).toBe(true);
  });

  it('reflects runtime env mutations (re-reads on every call)', () => {
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
    process.env.FEATURE_COMMISSION_PDF = '0';
    expect(isFeatureEnabled('commission_pdf')).toBe(false);
    delete process.env.FEATURE_COMMISSION_PDF;
    expect(isFeatureEnabled('commission_pdf')).toBe(true);
  });
});

describe('requireFeature', () => {
  it('returns silently when enabled', () => {
    expect(() => requireFeature('commission_pdf')).not.toThrow();
  });

  it('throws FeatureDisabledError when disabled, carrying the flag name', () => {
    process.env.FEATURE_COMMISSION_PDF = '0';
    let err: unknown;
    try {
      requireFeature('commission_pdf');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(FeatureDisabledError);
    expect((err as FeatureDisabledError).flag).toBe('commission_pdf');
    expect((err as Error).message).toContain('commission_pdf');
  });
});

describe('notFoundIfDisabled', () => {
  it('returns null when the flag is enabled', () => {
    expect(notFoundIfDisabled('commission_pdf')).toBeNull();
  });

  it('returns a 404 Response when disabled', async () => {
    process.env.FEATURE_COMMISSION_PDF = 'off';
    const res = notFoundIfDisabled('commission_pdf');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    expect(await res!.text()).toBe('Not Found');
  });
});

describe('contacts (M2)', () => {
  it('is opt-in: disabled by default, enabled by FEATURE_CONTACTS=1', () => {
    delete process.env.FEATURE_CONTACTS;
    expect(isFeatureEnabled('contacts')).toBe(false);
    process.env.FEATURE_CONTACTS = '1';
    expect(isFeatureEnabled('contacts')).toBe(true);
  });
});

describe('staff_chat (M4)', () => {
  it('is opt-in: disabled by default, enabled by FEATURE_STAFF_CHAT=1', () => {
    delete process.env.FEATURE_STAFF_CHAT;
    expect(isFeatureEnabled('staff_chat')).toBe(false);
    process.env.FEATURE_STAFF_CHAT = '1';
    expect(isFeatureEnabled('staff_chat')).toBe(true);
  });
});

describe('pii_access_log (§25.7)', () => {
  it('opt-out: включён при пустом env', () => {
    expect(isFeatureEnabled('pii_access_log')).toBe(true);
  });

  it('kill-switch: FEATURE_PII_ACCESS_LOG=0 выключает', () => {
    process.env.FEATURE_PII_ACCESS_LOG = '0';
    expect(isFeatureEnabled('pii_access_log')).toBe(false);
  });
});

describe('isOptInFlag / featureFlagEnvVar (ФТ-14.6 — матрица флагов)', () => {
  it('opt-in флаги распознаются, opt-out — нет', async () => {
    const { isOptInFlag } = await import('@/lib/featureFlags');
    expect(isOptInFlag('chat')).toBe(true);
    expect(isOptInFlag('staff_calendar')).toBe(true);
    expect(isOptInFlag('commission_pdf')).toBe(false);
    expect(isOptInFlag('pii_access_log')).toBe(false);
  });

  it('featureFlagEnvVar строит FEATURE_<UPPER_SNAKE>', async () => {
    const { featureFlagEnvVar } = await import('@/lib/featureFlags');
    expect(featureFlagEnvVar('chat')).toBe('FEATURE_CHAT');
    expect(featureFlagEnvVar('staff_2fa')).toBe('FEATURE_STAFF_2FA');
  });
});
