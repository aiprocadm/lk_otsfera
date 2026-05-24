import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db/prisma';
import { verifyAndConsumeToken } from '@/lib/auth/passwordReset';
import { recordAudit } from '@/lib/auth/audit';

const ConfirmSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

export async function POST(req: NextRequest) {
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
