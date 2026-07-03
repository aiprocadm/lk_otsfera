import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { protectedPrefixes, roleHome } from '@/lib/auth/access';
import type { Role } from '@/lib/auth/jwt';
import { isFeatureEnabled, type FeatureFlag } from '@/lib/featureFlags';

const FEATURE_PREFIXES: Array<{ prefix: string; flag: FeatureFlag }> = [
  { prefix: '/partner/leads', flag: 'partner_leads' },
  { prefix: '/partner/messages', flag: 'chat' },
  { prefix: '/organization/messages', flag: 'chat' },
  // T5: every enrollment surface dark-launches together under one flag (the
  // cabinet-level flags below still apply additively via their own prefixes).
  { prefix: '/partner/enrollments', flag: 'enrollment_requests' },
  { prefix: '/organization/enrollments', flag: 'enrollment_requests' },
  { prefix: '/manager/enrollments', flag: 'enrollment_requests' },
  { prefix: '/leader/enrollments', flag: 'enrollment_requests' },
  { prefix: '/admin/enrollments', flag: 'enrollment_requests' },
  { prefix: '/organization', flag: 'organization_cabinet' },
  { prefix: '/manager', flag: 'manager_cabinet' },
  { prefix: '/leader', flag: 'leader_cabinet' },
  // G1: конструктор ролей — отдельный флаг поверх кабинетных префиксов (additive).
  { prefix: '/leader/roles', flag: 'role_constructor' },
  { prefix: '/admin/roles', flag: 'role_constructor' },
  // G2: воронка продаж / канбан.
  { prefix: '/leader/funnel', flag: 'sales_funnel' },
  { prefix: '/manager/funnel', flag: 'sales_funnel' },
  // G3: внутренние задачи / канбан.
  { prefix: '/manager/tasks', flag: 'internal_tasks' },
  { prefix: '/leader/tasks', flag: 'internal_tasks' },
];

const MIN_JWT_SECRET_LENGTH = 32;

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) return null;
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    console.error('[auth] JWT_SECRET is too short; require at least', MIN_JWT_SECRET_LENGTH, 'chars');
    return null;
  }
  return new TextEncoder().encode(jwtSecret);
}

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('session')?.value;
  const pathname = req.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/reset-password');

  if (!token) {
    if (isAuthPage) return NextResponse.next();
    return NextResponse.redirect(new URL('/login', req.url));
  }

  const secret = getJwtSecret();
  if (!secret) {
    console.error('[auth] JWT secret is not configured; redirecting to /login');
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as Role;

    // Руководитель менеджеров при включённом кабинете попадает в /leader.
    // managerRole — контрактный claim JWT (C8); флаг проверяем здесь же,
    // чтобы при выключенном leader_cabinet редирект вёл в обычный кабинет.
    const isLeader = role === 'manager' && (payload as { managerRole?: string }).managerRole === 'leader';
    const home = isLeader && isFeatureEnabled('leader_cabinet') ? '/leader/dashboard' : roleHome[role];

    if (isAuthPage) {
      return NextResponse.redirect(new URL(home, req.url));
    }

    for (const [prefix, allowedRoles] of Object.entries(protectedPrefixes)) {
      if (pathname.startsWith(prefix) && !allowedRoles.includes(role)) {
        return NextResponse.redirect(new URL('/forbidden', req.url));
      }
    }

    if (role === 'partner') {
      const partnerRole = (payload as { partnerRole?: 'admin' | 'manager' }).partnerRole;
      const isAdminOnly =
        pathname.startsWith('/partner/team') ||
        /^\/partner\/portfolio\/[^/]+\/settings(?:\/|$)/.test(pathname);

      if (isAdminOnly && partnerRole !== 'admin') {
        return NextResponse.redirect(new URL('/forbidden', req.url));
      }
    }

    if (pathname === '/' || pathname === '/dashboard') {
      return NextResponse.redirect(new URL(home, req.url));
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
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
