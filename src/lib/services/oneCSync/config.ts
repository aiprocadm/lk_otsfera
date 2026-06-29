export type OneCMode = 'live' | 'shadow';

export function oneCMode(): OneCMode {
  return (process.env.ONE_C_MODE ?? 'live').trim().toLowerCase() === 'shadow' ? 'shadow' : 'live';
}

export function oneCHttpTimeoutMs(): number {
  const raw = Number(process.env.ONE_C_HTTP_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000;
}

export function oneCCursorOverlapMinutes(): number {
  const raw = Number(process.env.ONE_C_CURSOR_OVERLAP_MINUTES);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5;
}

/** Max replay attempts before a pending record is dead-lettered. */
export function oneCPendingMaxAttempts(): number {
  const raw = Number(process.env.ONE_C_PENDING_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? raw : 50;
}

/** Max age (days) before a still-pending record is dead-lettered. */
export function oneCPendingMaxAgeDays(): number {
  const raw = Number(process.env.ONE_C_PENDING_MAX_AGE_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}
