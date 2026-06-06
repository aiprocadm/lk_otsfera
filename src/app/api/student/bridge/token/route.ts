import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';
import { recordAudit } from '@/lib/auth/audit';
import { isRateLimited } from '@/lib/rateLimit';

const WINDOW_MS = Number(process.env.STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS ?? 60_000);
const LIMIT_PER_WINDOW = Number(process.env.STUDENT_BRIDGE_RATE_LIMIT_MAX ?? 10);

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

async function auditBridgeFailure(params: {
  action: string;
  userId: string;
  entityId?: string;
  clientId?: string;
  ip?: string | null;
  reason: string;
}) {
  const resolvedEntityId = params.entityId ?? params.clientId ?? 'unknown';

  await recordAudit(prisma, {
    action: params.action,
    entity: 'student_bridge',
    entityId: resolvedEntityId,
    userId: params.userId,
    status: 'denied',
    reason: params.reason,
    after: {
      clientId: params.clientId ?? null,
      ip: params.ip ?? null,
      entityId: resolvedEntityId,
    },
  });
}

export async function POST(req: NextRequest) {
  const sessionResult = await requireSession();
  if (!sessionResult.ok) return sessionResult.response;

  const roleResult = requireRole(sessionResult.value, ['student']);
  if (!roleResult.ok) return roleResult.response;

  const clientId = req.headers.get('x-bridge-client')?.trim() ?? '';
  const sharedSecret = req.headers.get('x-bridge-secret')?.trim() ?? '';
  const expectedSecret = process.env.STUDENT_BRIDGE_SHARED_SECRET?.trim() ?? '';
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');

  if (!clientId || !expectedSecret || !safeEqual(sharedSecret, expectedSecret)) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CLIENT_DENIED',
      userId: sessionResult.value.sub,
      clientId,
      ip,
      reason: 'client-auth-failed'
    });
    return NextResponse.json({ error: 'bridge client denied' }, { status: 403 });
  }

  const rateLimitKey = `${clientId}:${ip ?? 'unknown-ip'}`;
  if (await isRateLimited(rateLimitKey, { windowMs: WINDOW_MS, max: LIMIT_PER_WINDOW })) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_RATE_LIMITED',
      userId: sessionResult.value.sub,
      clientId,
      ip,
      reason: 'rate-limit-exceeded'
    });
    return NextResponse.json({ error: 'too many requests' }, { status: 429 });
  }

  const body = await req.json().catch(() => null) as { code?: string } | null;
  const code = body?.code?.trim();
  const safeError = { error: 'invalid exchange request' };

  if (!code) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CODE_REJECTED',
      userId: sessionResult.value.sub,
      clientId,
      ip,
      reason: 'missing-or-invalid-code'
    });
    return NextResponse.json(safeError, { status: 400 });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const claimed = await tx.studentBridgeGrant.updateMany({
      where: { code, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now }
    });

    if (claimed.count === 0) {
      const grant = await tx.studentBridgeGrant.findUnique({
        where: { code },
        select: { jti: true, usedAt: true, expiresAt: true }
      });
      return { kind: 'rejected' as const, grant };
    }

    const grant = await tx.studentBridgeGrant.findUnique({
      where: { code },
      select: { jti: true, token: true }
    });

    if (!grant) return { kind: 'rejected' as const, grant: null };

    await recordAudit(tx, {
      action: 'STUDENT_BRIDGE_CODE_EXCHANGED',
      entity: 'student_bridge',
      entityId: grant.jti,
      userId: sessionResult.value.sub,
      after: { clientId, ip: ip ?? null, exchangedAt: now.toISOString() },
    });

    return { kind: 'ok' as const, jti: grant.jti, token: grant.token };
  });

  if (result.kind === 'rejected') {
    if (!result.grant) {
      await auditBridgeFailure({
        action: 'STUDENT_BRIDGE_CODE_REJECTED',
        userId: sessionResult.value.sub,
        clientId,
        ip,
        reason: 'missing-or-invalid-code'
      });
      return NextResponse.json(safeError, { status: 400 });
    }

    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CODE_REUSE_BLOCKED',
      entityId: result.grant.jti,
      userId: sessionResult.value.sub,
      clientId,
      ip,
      reason: result.grant.usedAt ? 'already-used' : 'expired'
    });
    return NextResponse.json({ error: 'code is no longer valid' }, { status: 410 });
  }

  return NextResponse.json({ token: result.token, token_type: 'Bearer' });
}
