import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';

const studentBridgeSecret = new TextEncoder().encode(process.env.STUDENT_BRIDGE_JWT_SECRET ?? process.env.JWT_SECRET ?? '');

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
    .setIssuedAt(now)
    .setJti(jti)
    .setExpirationTime(`${getStudentBridgeTtl()}s`)
    .sign(studentBridgeSecret);

  return { token, jti, iat: now };
}

export async function verifyToken(token: string) {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return payload as unknown as SessionPayload;
}
