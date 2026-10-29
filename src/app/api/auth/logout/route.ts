import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { endSessionOnLogout } from '@/lib/services/auth/sessions';
import { bestEffort } from '@/lib/logging';

export async function POST() {
  // `У-324` (ТЗ 28.10.2026): выход отзывает токен на сервере, а не только
  // стирает cookie. Сбой базы не мешает выйти (§3, degrade gracefully):
  // cookie стирается в любом случае, сбой — в журнал.
  const session = await getSession();
  if (session) {
    await endSessionOnLogout(prisma, session).catch(bestEffort('[auth/logout] revoke failed'));
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', '', {
    maxAge: 0,
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
