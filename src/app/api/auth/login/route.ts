import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as React from 'react';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { signToken, signTwoFactorPendingToken } from '@/lib/auth/jwt';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';
import { isRateLimited } from '@/lib/rateLimit';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { createTwoFactorChallenge } from '@/lib/services/auth/twoFactor';
import { send } from '@/lib/email/send';
import {
  TwoFactorCodeTemplate,
  twoFactorCodeSubject,
  twoFactorCodeText,
} from '@/lib/email/templates/two-factor-code';
import { recordAudit } from '@/lib/auth/audit';
import { log } from '@/lib/logging';

// Dynamic import keeps react-dom/server out of the static module graph
// (тот же приём, что в reset-password/request).
async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
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
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Invalid request' },
      { status: 400 }
    );
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { code: 'INVALID_REQUEST', message: 'Invalid request' },
      { status: 400 }
    );
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
    return NextResponse.json(
      { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
      { status: 401 }
    );
  }

  const built = await buildSessionClaims(prisma, user);
  if (!built.ok) {
    return NextResponse.json(
      { code: 'ACCOUNT_DEACTIVATED', message: 'Account deactivated' },
      { status: 403 }
    );
  }

  // Staff 2FA (спека 2026-07-11): для сотрудников при включённом флаге сессия
  // НЕ выдаётся — вместо неё одноразовый email-код + pre-auth cookie. Ветка
  // стоит ПОСЛЕ buildSessionClaims, чтобы деактивированный аккаунт не получал
  // письмо. leader — это manager с managerRole='leader', отдельной ветки нет.
  const isStaff = user.role === 'admin' || user.role === 'manager';
  if (isStaff && isFeatureEnabled('staff_2fa')) {
    const { code } = await createTwoFactorChallenge(prisma, user.id);
    try {
      await send({
        to: user.email,
        subject: twoFactorCodeSubject(),
        html: await renderHtml(
          React.createElement(TwoFactorCodeTemplate, { name: user.name, code })
        ),
        text: twoFactorCodeText({ name: user.name, code }),
      });
    } catch (err) {
      // Без письма войти нельзя — честная ошибка вместо тихого проглота
      // (осознанное исключение из «notification fan-out проглатываем» §3).
      await prisma.twoFactorChallenge.delete({ where: { userId: user.id } }).catch(() => {});
      log.error('[auth/login] 2fa email send failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { code: 'EMAIL_SEND_FAILED', message: 'Failed to send the code' },
        { status: 502 }
      );
    }
    await recordAudit(prisma, {
      action: '2fa_code_sent',
      entity: 'auth_2fa',
      entityId: user.id,
      userId: user.id,
    }).catch(() => {});
    const pending = await signTwoFactorPendingToken(user.id);
    const res = NextResponse.json({ ok: true, twoFactorRequired: true });
    res.cookies.set('2fa_pending', pending, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return res;
  }

  // Этап 9 (ФТ-11.3): отметка входа. Best-effort (§3) — сбой апдейта не должен
  // лишать пользователя сессии, которую он уже заслужил верным паролем.
  await prisma.user
    .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    .catch(() => {});

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
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
