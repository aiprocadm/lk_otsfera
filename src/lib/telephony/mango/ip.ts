const DEFAULT = '81.88.80.132,81.88.80.133,81.88.82.36';

/** Checks a client IP against the Mango Office webhook source allowlist. */
export function isMangoIpAllowed(
  ip: string,
  allowlist = process.env.MANGO_ALLOWED_IPS ?? DEFAULT
): boolean {
  const set = new Set(
    allowlist
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return set.has((ip ?? '').trim());
}

/** Client IP from proxy headers (x-forwarded-for first hop, then x-real-ip). */
export function clientIpFrom(headers: Headers): string {
  return (headers.get('x-forwarded-for')?.split(',')[0] ?? headers.get('x-real-ip') ?? '').trim();
}
