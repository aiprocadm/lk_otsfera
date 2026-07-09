import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { verifyAndConsumeToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';
import { isRateLimited } from '@/lib/rateLimit';

const ConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

// R0.6: без лимитера маршрут позволял неограниченный перебор reset-токенов
// (и bcrypt.hash на каждый запрос — дешёвый CPU-DoS).
const IP_LIMIT = { windowMs: 60 * 1000, max: 10 };

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (await isRateLimited(`reset-confirm:ip:${clientIp(req)}`, IP_LIMIT)) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const parsed = ConfirmSchema.safeParse(body);
  if (!parsed.success) {
    // Distinguish weak_password from other validation errors
    const issue = parsed.error.issues.find((i) => i.path.includes('newPassword'));
    const code = issue ? 'weak_password' : 'invalid_request';
    return NextResponse.json({ error: code }, { status: 400 });
  }

  const { token, newPassword } = parsed.data;
  const newHash = await bcrypt.hash(newPassword, 10);
  const result = await verifyAndConsumeToken(prisma, token, newHash);

  if (!result.ok) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  await recordAudit(prisma, {
    userId: result.userId,
    action: 'password_reset',
    entity: 'user',
    entityId: result.userId,
    status: 'success',
  });

  return NextResponse.json({ ok: true });
}
