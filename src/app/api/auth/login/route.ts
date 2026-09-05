import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as React from 'react';
import { prisma } from '@/lib/db/prisma';
import { signToken, signTwoFactorPendingToken } from '@/lib/auth/jwt';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth/session';
import { buildSessionClaims } from '@/lib/auth/buildSessionClaims';
import { isRateLimited } from '@/lib/rateLimit';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { primeFeatureFlagCache } from '@/lib/config/featureFlagStore';
import {
  cachedIntegrationSetting,
  primeIntegrationSettingsCache,
} from '@/lib/config/integrationSettingsCache';
import { createTwoFactorChallenge, discardTwoFactorChallenge } from '@/lib/services/auth/twoFactor';
import { authenticateWithPassword, recordLastLogin } from '@/lib/services/auth/login';
import { send } from '@/lib/email/send';
import {
  TwoFactorCodeTemplate,
  twoFactorCodeSubject,
  twoFactorCodeText,
} from '@/lib/email/templates/two-factor-code';
import { recordAudit } from '@/lib/auth/audit';
import { bestEffort, log } from '@/lib/logging';

// Dynamic import keeps react-dom/server out of the static module graph
// (тот же приём, что в reset-password/request).
async function renderHtml(element: React.ReactElement): Promise<string> {
  const mod = await import('react-dom/server');
  return `<!DOCTYPE html>\n${mod.renderToStaticMarkup(element)}`;
}

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

/**
 * `У-129`: лимиты входа настраиваются в интерфейсе. Читаются НА КАЖДЫЙ запрос,
 * а не один раз при загрузке модуля: иначе правка подействовала бы только
 * после перезапуска — ровно та беда, которую этап и чинит.
 */
function loginLimits(): { windowMs: number; maxAttempts: number } {
  const windowMs = Number(
    cachedIntegrationSetting('login.rateLimitWindowMs') ?? process.env.LOGIN_RATE_LIMIT_WINDOW_MS
  );
  const maxAttempts = Number(
    cachedIntegrationSetting('login.rateLimitMax') ?? process.env.LOGIN_RATE_LIMIT_MAX
  );
  return {
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 10,
  };
}

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

  // `У-129`: лимиты живут в базе — снапшот настроек нужен ДО первой проверки.
  // Вход происходит до всякой сессии, праймить его больше некому (`У-133`).
  await primeIntegrationSettingsCache(prisma);
  const { windowMs, maxAttempts } = loginLimits();

  if (await isRateLimited(`login:${ip}`, { windowMs, max: maxAttempts })) {
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

  // Проверка пары email+пароль целиком за сервисом: там же и DUMMY-хеш, и
  // порядок веток, от которых зависит невозможность перечислить e-mail
  // (см. комментарий в services/auth/login.ts).
  const auth = await authenticateWithPassword(prisma, { email, password });

  if (!auth.ok) {
    return auth.error === 'account_not_activated'
      ? NextResponse.json(
          { code: 'ACCOUNT_NOT_ACTIVATED', message: 'Activate your account via the invite link.' },
          { status: 403 }
        )
      : NextResponse.json(
          { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' },
          { status: 401 }
        );
  }

  const user = auth.user;

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
  // письмо. leader — самостоятельная staff-роль (ТЗ 2026-08-17).
  const isStaff = user.role === 'admin' || user.role === 'manager' || user.role === 'leader';
  // `У-133`: вход происходит ДО всякой сессии, а снапшот флагов праймил только
  // `getSession()`. На холодном процессе включённая в интерфейсе 2FA здесь не
  // виделась — замкнутый круг (дефект `Д-37`). Прайм с TTL 30 с, поэтому
  // лишнего запроса в базу на каждый вход не будет.
  await primeFeatureFlagCache(prisma);
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
      await discardTwoFactorChallenge(prisma, user.id);
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
    }).catch(bestEffort('[auth/login] audit failed (2fa_code_sent)'));
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
  await recordLastLogin(prisma, user.id);

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
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return res;
}
