/** Skip reasons whose dependency may appear on a later sync, so the record is worth replaying. */
const TRANSIENT_REASONS = new Set(['organization_not_found', 'order_not_found', 'document_fetch_failed']);

/** True only for known dependency-ordering skips. Unknown/permanent reasons fail closed (no retry). */
export function isTransientSkip(reason: string): boolean {
  return TRANSIENT_REASONS.has(reason);
}
