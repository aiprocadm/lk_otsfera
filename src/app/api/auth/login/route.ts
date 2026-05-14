import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';
import { signToken } from '@/lib/auth/jwt';

export async function POST(req: Request) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const email = typeof payload === 'object' && payload !== null ? (payload as { email?: unknown }).email : undefined;
  const password = typeof payload === 'object' && payload !== null ? (payload as { password?: unknown }).password : undefined;

  if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || password.length === 0) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });

  const token = await signToken({
    sub: user.id,
    role: user.role,
    companyId: user.companyId,
    partnerId: user.partnerId,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    externalStudentId: user.externalStudentId
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  return res;
}
