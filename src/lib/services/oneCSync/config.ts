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
