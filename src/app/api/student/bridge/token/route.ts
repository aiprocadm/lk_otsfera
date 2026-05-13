import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';

export async function POST(req: NextRequest) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;

  const roleResult = requireRole(sessionResult.value, ['student']);
  if (!roleResult.ok) return roleResult.response;

  const body = await req.json().catch(() => null) as { code?: string } | null;
  const code = body?.code?.trim();

  if (!code) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }

  const grant = await prisma.studentBridgeGrant.findUnique({
    where: { code },
    select: { id: true, jti: true, token: true, userId: true, expiresAt: true, usedAt: true }
  });

  if (!grant) {
    return NextResponse.json({ error: 'invalid code' }, { status: 404 });
  }

  const now = new Date();
  const isExpired = grant.expiresAt <= now;

  if (grant.usedAt || isExpired) {
    await prisma.auditLog.create({
      data: {
        action: 'STUDENT_BRIDGE_CODE_REUSE_BLOCKED',
        entity: 'student_bridge_code',
        entityId: grant.jti,
        userId: grant.userId,
        meta: { code, usedAt: grant.usedAt?.toISOString() ?? null, expiredAt: grant.expiresAt.toISOString() }
      }
    });
    return NextResponse.json({ error: 'code is no longer valid' }, { status: 410 });
  }

  await prisma.$transaction([
    prisma.studentBridgeGrant.update({
      where: { id: grant.id },
      data: { usedAt: now }
    }),
    prisma.auditLog.create({
      data: {
        action: 'STUDENT_BRIDGE_CODE_EXCHANGED',
        entity: 'student_bridge_code',
        entityId: grant.jti,
        userId: grant.userId,
        meta: { code, exchangedAt: now.toISOString() }
      }
    })
  ]);

  return NextResponse.json({ token: grant.token, token_type: 'Bearer' });
}
