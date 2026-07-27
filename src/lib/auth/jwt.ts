import { randomUUID } from 'crypto';
import { JWTPayload, SignJWT, jwtVerify } from 'jose';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { sessionAccessProfileSchema, type SessionAccessProfile } from '@/lib/auth/accessProfile';

const MIN_JWT_SECRET_LENGTH = 32;

function assertSecretStrength(secret: string, varName: string): string {
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`${varName} must be at least ${MIN_JWT_SECRET_LENGTH} characters`);
  }
  return secret;
}

export type Role = 'admin' | 'manager' | 'partner' | 'organization' | 'student';

// Словарь под-ролей. «Старший»/team-lead проекта реализован тремя под-ролями
// (by design §4 — три домена, три гарда) и в каждом назван по-разному:
//  - partnerRole='admin'    = партнёрский администратор (управляет командой партнёра).
//    Гард requirePartnerAdmin (partnerRole === 'admin'). ВНИМАНИЕ: partnerRole='manager'
//    — наоборот, обычный scoped-партнёр (дефолт), НЕ админ; строка 'manager' здесь
//    не связана с top-level Role 'manager' (разные поля/namespace).
//  - roleInOrg='leader'     = старший в организации (+ 'admin'). Гард requireOrganizationAdminOrLeader.
//  - managerRole='leader'   = старший менеджер (company-wide, C8). Гард requireManagerLeader.
// Значения СТАБИЛЬНЫ (миграция дорогая). Контракт отказа по под-роли единый:
// redirect → /forbidden (см. requireRole.ts).
export type PartnerRoleInPartner = 'admin' | 'manager';

export type OrgRoleInOrg = 'admin' | 'leader' | 'member';

export type ManagerRole = 'leader';

export type OrganizationMembership = {
  organizationId: string;
  roleInOrg: OrgRoleInOrg;
  isActive: boolean;
};

export type SessionPayload = {
  sub: string;
  role: Role;
  companyId?: string | null;
  partnerId?: string | null;
  partnerRole?: PartnerRoleInPartner | null;
  assignedOrgIds?: string[];
  managedOrgIds?: string[];
  managerRole?: ManagerRole | null;
  organizationId?: string | null;
  organizationMemberships?: OrganizationMembership[];
  email?: string;
  name?: string;
  externalStudentId?: string | null;
  // Трек G1: кастомный профиль доступа, денормализованный в JWT при логине
  // (только для менеджеров). null/undefined = legacy teamMode-поведение.
  accessProfile?: SessionAccessProfile | null;
  // Этап 9 (ФТ-11.2): версия сессии на момент выдачи токена. Опциональна
  // намеренно — токены, выданные до деплоя, клейма не несут и трактуются как
  // версия 0 (иначе релиз разлогинил бы всех). Сверка — в getSession().
  sessionVersion?: number;
};

export type StudentBridgePayload = Pick<SessionPayload, 'sub' | 'role' | 'organizationId' | 'email' | 'name' | 'externalStudentId'>;

// Runtime guards for verified JWT payloads. `jwtVerify` returns an untyped
// `JWTPayload` (string-keyed, values `unknown`); casting it straight to our
// session shape would trust a malformed/forged token's structure. These schemas
// validate the contractual claims at the trust boundary. Unknown standard claims
// (iat/exp/aud/iss/jti) are stripped here and re-merged where the caller needs them.
const roleSchema = z.enum(['admin', 'manager', 'partner', 'organization', 'student']);

const organizationMembershipSchema = z.object({
  organizationId: z.string(),
  roleInOrg: z.enum(['admin', 'leader', 'member']),
  isActive: z.boolean()
});

const sessionPayloadSchema = z.object({
  sub: z.string().min(1),
  role: roleSchema,
  companyId: z.string().nullish(),
  partnerId: z.string().nullish(),
  partnerRole: z.enum(['admin', 'manager']).nullish(),
  assignedOrgIds: z.array(z.string()).optional(),
  managedOrgIds: z.array(z.string()).optional(),
  managerRole: z.literal('leader').nullish(),
  organizationId: z.string().nullish(),
  organizationMemberships: z.array(organizationMembershipSchema).optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  externalStudentId: z.string().nullish(),
  accessProfile: sessionAccessProfileSchema.nullish(),
  sessionVersion: z.number().int().optional()
});

const studentBridgePayloadSchema = z.object({
  sub: z.string().min(1),
  role: roleSchema,
  organizationId: z.string().nullish(),
  email: z.string().optional(),
  name: z.string().optional(),
  externalStudentId: z.string().nullish()
});


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

export async function verifyToken(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return sessionPayloadSchema.parse(payload) as SessionPayload;
}

const TWO_FACTOR_PENDING_TTL = '10m';

const twoFactorPendingSchema = z.object({
  sub: z.string().min(1),
  purpose: z.literal('2fa')
});

/**
 * Pre-auth токен шага 2FA (staff-логин, спека 2026-07-11): выдан после верного
 * пароля, до ввода email-кода. Намеренно НЕ содержит role — sessionPayloadSchema
 * (verifyToken) такой payload отвергает, поэтому pre-auth токен не открывает ни
 * один маршрут, даже если подложить его в cookie `session`. Guard-тест:
 * auth.jwt.2fa-pending.test.ts.
 */
export async function signTwoFactorPendingToken(userId: string) {
  return new SignJWT({ sub: userId, purpose: '2fa' })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(TWO_FACTOR_PENDING_TTL)
    .sign(getJwtSecret());
}

export async function verifyTwoFactorPendingToken(token: string): Promise<{ sub: string }> {
  const { payload } = await jwtVerify(token, getJwtSecret());
  return twoFactorPendingSchema.parse(payload);
}


export async function verifyStudentBridgeToken(token: string) {
  const { payload } = await jwtVerify(token, getStudentBridgeSecret(), {
    audience: 'external-student-portal',
    issuer: getStudentBridgeIssuer()
  });

  if (!payload.jti || !payload.exp) {
    throw new Error('invalid student bridge token payload');
  }

  // Validate the contractual claims; re-merge onto the raw payload so standard
  // JWT claims (aud/iss/jti/exp/iat) consumed downstream are preserved.
  const claims = studentBridgePayloadSchema.parse(payload);

  await consumeStudentBridgeJti(payload.jti, payload.exp);

  return { ...payload, ...claims } as JWTPayload & StudentBridgePayload;
}
