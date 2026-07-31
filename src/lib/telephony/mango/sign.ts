import { createHash, timingSafeEqual } from 'node:crypto';

/** sha256(apiKey + json + salt) — Mango Office webhook signature scheme. */
export function computeMangoSign(apiKey: string, json: string, salt: string): string {
  return createHash('sha256')
    .update(apiKey + json + salt)
    .digest('hex');
}

/** Constant-time comparison against the expected sign; safe for mismatched lengths. */
export function verifyMangoSign(args: {
  apiKey: string;
  salt: string;
  json: string;
  sign: string;
}): boolean {
  const expected = computeMangoSign(args.apiKey, args.json, args.salt);
  const a = Buffer.from(expected);
  const b = Buffer.from(args.sign ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
