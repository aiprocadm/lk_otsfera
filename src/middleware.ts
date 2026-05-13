import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { protectedPrefixes, roleHome } from '@/lib/auth/access';
import type { Role } from '@/lib/auth/jwt';

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) return null;
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

    if (isAuthPage) {
      return NextResponse.redirect(new URL(roleHome[role], req.url));
    }

    for (const [prefix, allowedRoles] of Object.entries(protectedPrefixes)) {
      if (pathname.startsWith(prefix) && !allowedRoles.includes(role)) {
        return NextResponse.redirect(new URL('/forbidden', req.url));
      }
    }

    if (pathname === '/' || pathname === '/dashboard') {
      return NextResponse.redirect(new URL(roleHome[role], req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL('/login', req.url));
  }
}

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
