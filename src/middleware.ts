import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { protectedPrefixes, roleHome } from '@/lib/auth/access';
import type { Role } from '@/lib/auth/jwt';

const secret = new TextEncoder().encode(process.env.JWT_SECRET);

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('session')?.value;
  const pathname = req.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/reset-password');

  if (!token) {
    if (isAuthPage) return NextResponse.next();
    return NextResponse.redirect(new URL('/login', req.url));
  }

  try {
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as Role;

    if (isAuthPage) {
      return NextResponse.redirect(new URL(roleHome[role], req.url));
    }

    if (pathname.startsWith('/admin') && role !== 'admin') {
      return NextResponse.redirect(new URL('/forbidden', req.url));
    }

    if (pathname.startsWith('/manager') && role !== 'manager') {
      return NextResponse.redirect(new URL('/forbidden', req.url));
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
