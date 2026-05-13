import { randomUUID } from 'crypto';
import { JWTPayload, SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/lib/db/prisma';


export type Role = 'admin' | 'manager' | 'partner' | 'organization' | 'student';

export type SessionPayload = {
  sub: string;
  role: Role;
  companyId?: string | null;
  partnerId?: string | null;
  organizationId?: string | null;
  email?: string;
  name?: string;
  externalStudentId?: string | null;
};

export type StudentBridgePayload = Pick<SessionPayload, 'sub' | 'role' | 'organizationId' | 'email' | 'name' | 'externalStudentId'>;


function getStudentBridgeSecret() {
  const secret = (process.env.STUDENT_BRIDGE_JWT_SECRET ?? process.env.JWT_SECRET ?? '').trim();
  if (!secret) {
    throw new Error('STUDENT_BRIDGE_JWT_SECRET (or JWT_SECRET) is not configured');
  }

  return new TextEncoder().encode(secret);
}

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return new TextEncoder().encode(jwtSecret);
}

export async function signToken(payload: SessionPayload) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('7d').sign(getJwtSecret());
}


function getStudentBridgeIssuer() {
  const issuer = process.env.STUDENT_BRIDGE_ISSUER?.trim() || process.env.APP_URL?.trim();
  if (!issuer) {
    throw new Error('STUDENT_BRIDGE_ISSUER (or APP_URL) is not configured');
  }

  return issuer;
}

async function consumeStudentBridgeJti(jti: string, exp: number) {
  const existing = await prisma.studentBridgeTokenJti.findUnique({ where: { jti }, select: { usedAt: true } });

  if (existing?.usedAt) {
    throw new Error('student bridge token replay detected');
  }

  const expiresAt = new Date(exp * 1000);

  await prisma.studentBridgeTokenJti.upsert({
    where: { jti },
    create: { jti, expiresAt, usedAt: new Date() },
    update: { usedAt: new Date(), expiresAt }
  });
}

function getStudentBridgeTtl() {
  const configured = Number(process.env.STUDENT_BRIDGE_TTL ?? 600);
  if (!Number.isFinite(configured)) return 600;
  return Math.min(900, Math.max(300, configured));
}

export async function signStudentBridgeToken(payload: StudentBridgePayload) {
  const jti = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience('external-student-portal')
    .setIssuer(getStudentBridgeIssuer())
    .setIssuedAt(now)
    .setJti(jti)
    .setExpirationTime(`${getStudentBridgeTtl()}s`)
    .sign(getStudentBridgeSecret());

  return { token, jti, iat: now };
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return payload as unknown as SessionPayload;
}


export async function verifyStudentBridgeToken(token: string) {
  const { payload } = await jwtVerify(token, getStudentBridgeSecret(), {
    audience: 'external-student-portal',
    issuer: getStudentBridgeIssuer()
  });

  if (!payload.jti || !payload.exp) {
    throw new Error('invalid student bridge token payload');
  }

  await consumeStudentBridgeJti(payload.jti, payload.exp);

  return payload as JWTPayload & StudentBridgePayload;
}
