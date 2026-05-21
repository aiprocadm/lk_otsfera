import { randomUUID } from 'crypto';
import { JWTPayload, SignJWT, jwtVerify } from 'jose';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const MIN_JWT_SECRET_LENGTH = 32;

function assertSecretStrength(secret: string, varName: string): string {
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`${varName} must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  return secret;
}

export type Role = 'admin' | 'manager' | 'partner' | 'organization' | 'student';

export type PartnerRoleInPartner = 'admin' | 'manager';

export type SessionPayload = {
  sub: string;
  role: Role;
  companyId?: string | null;
  partnerId?: string | null;
  partnerRole?: PartnerRoleInPartner | null;
  assignedOrgIds?: string[];
  organizationId?: string | null;
  email?: string;
  name?: string;
  externalStudentId?: string | null;
};

export type StudentBridgePayload = Pick<SessionPayload, 'sub' | 'role' | 'organizationId' | 'email' | 'name' | 'externalStudentId'>;


function getStudentBridgeSecret() {
  const fromBridgeVar = process.env.STUDENT_BRIDGE_JWT_SECRET?.trim();
  const studentBridgeSecret = (fromBridgeVar || process.env.JWT_SECRET?.trim() || '');
  if (!studentBridgeSecret) {
    throw new Error('Student bridge JWT secret is not configured');
  }

  const varName = fromBridgeVar ? 'STUDENT_BRIDGE_JWT_SECRET' : 'JWT_SECRET';
  return new TextEncoder().encode(assertSecretStrength(studentBridgeSecret, varName));
}

function getJwtSecret() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return new TextEncoder().encode(assertSecretStrength(jwtSecret, 'JWT_SECRET'));
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
  const expiresAt = new Date(exp * 1000);

  try {
    await prisma.studentBridgeTokenJti.create({
      data: { jti, expiresAt, usedAt: new Date() }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('student bridge token replay detected');
    }
    throw error;
  }
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
