import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { verifyTwoFactorPendingToken, signToken } from '@/lib/auth/jwt';
import { verifyTwoFactorCode } from '@/lib/services/auth/twoFactor';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';
import { recordAudit } from '@/lib/auth/audit';
import { isRateLimited } from '@/lib/rateLimit';

const schema = z.object({ code: z.string().min(1).max(64) });

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

// Обмен email-кода (или backup-кода) на полноценную сессию. Тонкий роут (§3):
// вся доменная логика — в services/auth/twoFactor; здесь только маппинг кодов
// в HTTP и cookie-механика.
export async function POST(req: NextRequest) {
  const disabled = notFoundIfDisabled('staff_2fa');
  if (disabled) return disabled;

  if (await isRateLimited(`2fa-verify:${clientIp(req)}`, { windowMs: 60_000, max: 10 })) {
    return NextResponse.json({ code: 'TOO_MANY_REQUESTS', message: 'Too many attempts' }, { status: 429 });
  }

  const pending = req.cookies.get('2fa_pending')?.value;
  if (!pending) {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }

  let sub: string;
  try {
    ({ sub } = await verifyTwoFactorPendingToken(pending));
  } catch {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const result = await verifyTwoFactorCode(prisma, sub, parsed.data.code.trim());
  if (!result.ok) {
    await recordAudit(prisma, {
      action: '2fa_failed',
      entity: 'auth_2fa',
      entityId: sub,
      userId: sub,
      status: 'denied',
      reason: result.error
    }).catch(() => {});
    return NextResponse.json({ code: result.error.toUpperCase(), message: 'Verification failed' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: sub } });
  if (!user || !user.isActive) {
    return NextResponse.json({ code: 'SESSION_EXPIRED', message: 'Login again' }, { status: 401 });
  }
  const built = await buildSessionClaims(prisma, user);
  if (!built.ok) {
    return NextResponse.json({ code: 'ACCOUNT_DEACTIVATED', message: 'Account deactivated' }, { status: 403 });
  }

  await recordAudit(prisma, {
    action: result.method === 'backup' ? '2fa_backup_used' : '2fa_verified',
    entity: 'auth_2fa',
    entityId: sub,
    userId: sub
  }).catch(() => {});

  // Этап 9 (ФТ-11.3): второй путь входа — отметка та же, тоже best-effort (§3).
  await prisma.user.update({ where: { id: sub }, data: { lastLoginAt: new Date() } }).catch(() => {});

  const token = await signToken(built.claims);
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Синхронно с login-роутом: срок cookie = сроку 7d-JWT
    maxAge: 60 * 60 * 24 * 7
  });
  res.cookies.set('2fa_pending', '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
