/**
 * Env-driven feature flags. Read points:
 *   - src/middleware.ts: returns 404 for protected feature prefixes
 *   - src/lib/navigation/cabinet.ts: hides menu items
 *   - route handlers: requireFeature() to hard-block API access
 *
 * Convention: `FEATURE_<UPPER_SNAKE>` env, defaulting to **enabled** when
 * unset. Disable by setting the env to `0` / `false` / `off`.
 *
 * Default-true matters for safety: if an operator forgets to set the env
 * during rollout, the feature stays on rather than silently disappearing.
 * Opt-out > opt-in for production environments.
 */

export const FEATURE_FLAGS = [
  'partner_leads',
  'commission_pdf',
  'commission_xlsx',
  'pwa_installer',
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  'chat',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/**
 * Opt-in flags default to **disabled** — they must be explicitly enabled with
 * env=1 / true / on. The rest of FEATURE_FLAGS keep the opt-out (default-true)
 * convention. Use sparingly: only for dark-launch / staged-rollout features.
 */
const OPT_IN_FLAGS = new Set<FeatureFlag>([
  'organization_cabinet',
  'manager_cabinet',
  'leader_cabinet',
  'chat'
]);

export class FeatureDisabledError extends Error {
  constructor(public flag: FeatureFlag) {
    super(`Feature disabled: ${flag}`);
    this.name = 'FeatureDisabledError';
  }
}

function envKey(flag: FeatureFlag): string {
  return `FEATURE_${flag.toUpperCase()}`;
}

const FALSY_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);
const TRUTHY_VALUES = new Set(['1', 'true', 'on', 'yes', 'enabled']);

/**
 * Returns true unless the corresponding env explicitly disables the flag.
 * Reads `process.env` on every call so tests can flip values without
 * restarting the module — see src/__tests__/featureFlags.test.ts.
 *
 * Opt-in flags (see OPT_IN_FLAGS) invert the logic: unset/empty env means
 * disabled, and only an explicit truthy value enables them.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[envKey(flag)];
  const isOptIn = OPT_IN_FLAGS.has(flag);
  if (raw === undefined || raw === '') return !isOptIn;
  const normalized = raw.trim().toLowerCase();
  if (isOptIn) return TRUTHY_VALUES.has(normalized);
  return !FALSY_VALUES.has(normalized);
}

/**
 * Hard gate for route handlers. Throws `FeatureDisabledError` when the
 * flag is off; callers either let it surface (becomes 500) or catch it
 * and return a 404.
 */
export function requireFeature(flag: FeatureFlag): void {
  if (!isFeatureEnabled(flag)) {
    throw new FeatureDisabledError(flag);
  }
}

/**
 * Cheap helper for callers that want to translate a flag check into a
 * Next response. Returns null when the flag is enabled (caller continues).
 */
export function notFoundIfDisabled(flag: FeatureFlag): Response | null {
  if (isFeatureEnabled(flag)) return null;
  return new Response('Not Found', { status: 404 });
}
