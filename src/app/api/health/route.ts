// Readiness: can the app serve traffic? Checks DB + Redis + S3. Token-gated.
import type { NextRequest } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { checkDb, checkRedis, checkS3 } from '@/lib/health/checks';

export const dynamic = 'force-dynamic';

function bearerMatches(req: NextRequest, expected: string): boolean {
  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  // sha256 both to a fixed 32-byte length so timingSafeEqual never throws on
  // a length mismatch (it requires equal-length buffers).
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const expected = process.env.HEALTH_TOKEN?.trim();
  if (!expected) {
    // Fail closed: a misconfigured probe reads as "not ready", surfaced loudly
    // on the first readiness check after deploy rather than silently public.
    return Response.json(
      { status: 'down', reason: 'health_token_unconfigured' },
      { status: 503 }
    );
  }
  if (!bearerMatches(req, expected)) {
    return Response.json({ status: 'unauthorized' }, { status: 401 });
  }

  const [db, redis, s3] = await Promise.all([checkDb(prisma), checkRedis(), checkS3()]);
  const ok = db.ok && redis.ok && s3.ok;
  return Response.json(
    { status: ok ? 'ok' : 'down', checks: { db, redis, s3 } },
    { status: ok ? 200 : 503 }
  );
}
