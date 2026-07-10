import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth/jwt';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';
import { isRateLimited } from '@/lib/rateLimit';

const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);

// Общий Redis-backed лимитер (@/lib/rateLimit): счётчик делится между всеми
// инстансами и переживает cold start; при недоступном Redis сам деградирует
// в in-memory. Ключ по IP: реальность x-forwarded-for обеспечивает
// reverse-proxy (перезапись XFF — требование release-чеклиста, как и для
// Mango IP-allowlist).
function clientIp(req: Request): string {
  const headers = req.headers;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  if (await isRateLimited(`login:${ip}`, { windowMs: WINDOW_MS, max: MAX_ATTEMPTS })) {
    return NextResponse.json(
      { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again later.' },
      { status: 429 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.passwordHash === null) {
    return NextResponse.json(
      { code: 'ACCOUNT_NOT_ACTIVATED', message: 'Activate your account via the invite link.' },
      { status: 403 }
    );
  }

  const hashToCompare = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const ok = await bcrypt.compare(password, hashToCompare);

  if (!user || !ok) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });
  }

  const built = await buildSessionClaims(prisma, user);
  if (!built.ok) {
    return NextResponse.json({ code: 'ACCOUNT_DEACTIVATED', message: 'Account deactivated' }, { status: 403 });
  }

  const token = await signToken(built.claims);

  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Align the cookie lifetime with the 7d JWT expiry. Without maxAge this is a
    // session cookie (cleared on browser close), so the effective session
    // lifetime diverged from the token it carries.
    maxAge: 60 * 60 * 24 * 7
  });
  return res;
}
