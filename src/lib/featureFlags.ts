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
  'one_c_sync',
  'pwa_installer',
  'document_scan',
] as const;

export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

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

/**
 * Returns true unless the corresponding env explicitly disables the flag.
 * Reads `process.env` on every call so tests can flip values without
 * restarting the module — see src/__tests__/featureFlags.test.ts.
 */
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  const raw = process.env[envKey(flag)];
  if (raw === undefined || raw === '') return true;
  return !FALSY_VALUES.has(raw.trim().toLowerCase());
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
