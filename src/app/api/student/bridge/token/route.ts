import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireRole, requireSession } from '@/lib/auth/guard';

const WINDOW_MS = Number(process.env.STUDENT_BRIDGE_RATE_LIMIT_WINDOW_MS ?? 60_000);
const LIMIT_PER_WINDOW = Number(process.env.STUDENT_BRIDGE_RATE_LIMIT_MAX ?? 10);
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

function maskCode(code?: string) {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  const head = trimmed.slice(0, 4);
  return `${head}***(${trimmed.length})`;
}

function isRateLimited(key: string) {
  const now = Date.now();
  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  current.count += 1;
  return current.count > LIMIT_PER_WINDOW;
}

async function auditBridgeFailure(params: {
  action: string;
  userId?: string;
  entityId?: string;
  code?: string;
  clientId?: string;
  ip?: string | null;
  reason: string;
}) {
  await prisma.auditLog.create({
    data: {
      action: params.action,
      entity: 'student_bridge_code',
      entityId: params.entityId ?? params.clientId ?? 'unknown',
      userId: params.userId,
      meta: {
        reason: params.reason,
        clientId: params.clientId ?? null,
        ip: params.ip ?? null,
        code: maskCode(params.code)
      }
    }
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

  if (!clientId || !expectedSecret || sharedSecret !== expectedSecret) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CLIENT_DENIED',
      userId: sessionResult.value.user.id,
      clientId,
      ip,
      reason: 'client-auth-failed'
    });
    return NextResponse.json({ error: 'bridge client denied' }, { status: 403 });
  }

  const rateLimitKey = `${clientId}:${ip ?? 'unknown-ip'}`;
  if (isRateLimited(rateLimitKey)) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_RATE_LIMITED',
      userId: sessionResult.value.user.id,
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
      userId: sessionResult.value.user.id,
      clientId,
      ip,
      reason: 'missing-or-invalid-code'
    });
    return NextResponse.json(safeError, { status: 400 });
  }

  const grant = await prisma.studentBridgeGrant.findUnique({
    where: { code },
    select: { id: true, jti: true, token: true, userId: true, expiresAt: true, usedAt: true }
  });

  if (!grant) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CODE_REJECTED',
      userId: sessionResult.value.user.id,
      clientId,
      ip,
      code,
      reason: 'missing-or-invalid-code'
    });
    return NextResponse.json(safeError, { status: 400 });
  }

  const now = new Date();
  const isExpired = grant.expiresAt <= now;

  if (grant.usedAt || isExpired) {
    await auditBridgeFailure({
      action: 'STUDENT_BRIDGE_CODE_REUSE_BLOCKED',
      entityId: grant.jti,
      userId: grant.userId,
      code,
      clientId,
      ip,
      reason: grant.usedAt ? 'already-used' : 'expired'
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
        meta: { clientId, ip: ip ?? null, exchangedAt: now.toISOString() }
      }
    })
  ]);

  return NextResponse.json({ token: grant.token, token_type: 'Bearer' });
}
