import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
const secret = new TextEncoder().encode(process.env.JWT_SECRET);
export async function middleware(req: NextRequest){
  const token = req.cookies.get('session')?.value;
  const isAuthPage = req.nextUrl.pathname.startsWith('/login') || req.nextUrl.pathname.startsWith('/reset-password');
  if (!token && !isAuthPage) return NextResponse.redirect(new URL('/login', req.url));
  if (token) { try { await jwtVerify(token, secret); if (isAuthPage) return NextResponse.redirect(new URL('/dashboard', req.url)); } catch { return NextResponse.redirect(new URL('/login', req.url)); }}
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
