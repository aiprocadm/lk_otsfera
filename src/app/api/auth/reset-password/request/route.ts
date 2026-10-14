import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { sendPasswordResetLink } from '@/lib/services/auth/passwordResetRequest';
import { isRateLimited } from '@/lib/rateLimit';
import { isEmailDeliveryConfigured } from '@/lib/email/transport';

import { clientIpFromHeaders } from '@/lib/api/clientIp';
// R0.6: до лимитера маршрут был вектором email-бомбинга жертвы (каждый запрос
// на существующий email пишет токен в БД и шлёт письмо). Двухключевой лимит:
// per-IP (широкий) + per-email (узкий) — 429 не раскрывает существование
// аккаунта, т.к. применяется к любому email одинаково.
const IP_LIMIT = { windowMs: 60 * 60 * 1000, max: 20 };
const EMAIL_LIMIT = { windowMs: 60 * 60 * 1000, max: 5 };

const RequestSchema = z.object({ email: z.string().email() });

export async function POST(req: NextRequest) {
  if (await isRateLimited(`reset-request:ip:${clientIpFromHeaders(req.headers)}`, IP_LIMIT)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const { email } = parsed.data;

  if (await isRateLimited(`reset-request:email:${email.toLowerCase()}`, EMAIL_LIMIT)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  // Сервис ничего не возвращает намеренно — ответ один и тот же независимо от
  // того, нашёлся ли активный аккаунт (guard от перечисления e-mail).
  await sendPasswordResetLink(prisma, email);

  // `У-271` (`Д-54`): уйдёт ли письмо вообще — признак настроек ПЛАТФОРМЫ, а
  // не адреса: одинаков для любого email, перечислить аккаунты по нему нельзя.
  // Без него экран обещал письмо, которое при выключенной почте не уходит.
  return NextResponse.json({ ok: true, emailDelivery: await isEmailDeliveryConfigured() });
}
