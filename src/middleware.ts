import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import type { NextRequest } from 'next/server';
import { protectedPrefixes, roleHome } from '@/lib/auth/access';
import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, FEATURE_PREFIXES } from '@/lib/featureFlags';
import { edgeLog } from '@/lib/logging/edge';

const MIN_JWT_SECRET_LENGTH = 32;

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) return null;
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    edgeLog.error(
      '[auth] JWT_SECRET is too short; require at least',
      MIN_JWT_SECRET_LENGTH,
      'chars'
    );
    return null;
  }
  return new TextEncoder().encode(jwtSecret);
}

/** Имя сайта в шапке: буквы, цифры, точки, дефисы и, может быть, порт. */
const HOST_RE = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * Адрес, по которому пришёл человек, — от шапок посредника.
 *
 * За посредником (nginx) Next.js собирает `req.url` на своём внутреннем имени
 * `localhost:3000`, а схему берёт из `X-Forwarded-Proto`. Перенаправление
 * `new URL(path, req.url)` выходило `https://localhost:3000/…`, и Next.js не
 * сокращал его до относительного (схема другая) — живой пользователь уходил
 * «в никуда» при истёкшей сессии, переходе на «/dashboard» или в чужой кабинет
 * (найдено сухим прогоном приёмки 17.10.2026). Посредник сам перезаписывает
 * `Host`/`X-Forwarded-Host`/`X-Forwarded-Proto` — снаружи их не подменить.
 * Кривое значение — как раньше, от `req.url`.
 */
function publicOrigin(req: NextRequest): string | null {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))
    ?.split(',')[0]
    ?.trim();
  if (!host || !HOST_RE.test(host)) return null;
  const proto = (
    req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    req.nextUrl.protocol.replace(/:$/, '')
  ).toLowerCase();
  if (proto !== 'http' && proto !== 'https') return null;
  return `${proto}://${host}`;
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, publicOrigin(req) ?? req.url));
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('session')?.value;
  const pathname = req.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/reset-password');

  if (!token) {
    if (isAuthPage) return NextResponse.next();
    return redirectTo(req, '/login');
  }

  const secret = getJwtSecret();
  if (!secret) {
    edgeLog.error('[auth] JWT secret is not configured; redirecting to /login');
    return redirectTo(req, '/login');
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as Role;

    // Дом роли. Руководитель попадает в свой кабинет: роль говорит сама за
    // себя, суб-роли больше нет (ТЗ 2026-08-17). До `У-262` здесь была развилка
    // «а если флаг `leader_cabinet` выключен — веди в кабинет менеджера»; флаг
    // снят, потому что выключенный кабинет роли это не откат фичи, а «роль не
    // может войти никуда».
    const home = roleHome[role];

    if (isAuthPage) {
      return redirectTo(req, home);
    }

    for (const [prefix, allowedRoles] of Object.entries(protectedPrefixes)) {
      if (pathname.startsWith(prefix) && !allowedRoles.includes(role)) {
        return redirectTo(req, '/forbidden');
      }
    }

    if (role === 'partner') {
      const partnerRole = (payload as { partnerRole?: 'admin' | 'manager' }).partnerRole;
      // `/partner/team` отсюда снят (`У-263`, прогон сопровождения №37): адрес
      // был шлюзом во вкладку «Команда» настроек и удалён. Вкладку закрывает
      // сама страница настроек — участнику без прав администратора её не
      // показывают.
      const isAdminOnly = /^\/partner\/portfolio\/[^/]+\/settings(?:\/|$)/.test(pathname);

      if (isAdminOnly && partnerRole !== 'admin') {
        return redirectTo(req, '/forbidden');
      }
    }

    if (pathname === '/' || pathname === '/dashboard') {
      return redirectTo(req, home);
    }

    // Feature-flag gate: 404 for prefixes whose flag is disabled. Runs after
    // auth so we don't leak existence to unauthenticated callers — and
    // returns a plain 404 (the app's not-found.tsx renders for app routes
    // that fall through, but middleware returns the status directly here).
    for (const { prefix, flag } of FEATURE_PREFIXES) {
      if (pathname.startsWith(prefix) && !isFeatureEnabled(flag)) {
        return new NextResponse('Not Found', { status: 404 });
      }
    }

    return NextResponse.next();
  } catch {
    return redirectTo(req, '/login');
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
