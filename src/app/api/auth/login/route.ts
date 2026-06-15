import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';
import { signToken, type OrganizationMembership } from '@/lib/auth/jwt';

const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);
const MAX_RATE_LIMIT_ENTRIES = 10_000;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/* v8 ignore next 7 -- cleanupAttempts body triggered only when Map reaches 10 000 entries; not unit-testable */
function cleanupAttempts(now: number) {
  if (loginAttempts.size < MAX_RATE_LIMIT_ENTRIES) return;
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key);
  }
}

function isLoginRateLimited(key: string): boolean {
  const now = Date.now();
  cleanupAttempts(now);
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS;
}

function clientIp(req: Request): string {
  const headers = req.headers;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  if (isLoginRateLimited(ip)) {
    return NextResponse.json(
      { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again later.' },
      { status: 429 }
    );
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: 'Invalid request' }, { status: 400 });
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  if (user && user.passwordHash === null) {
    return NextResponse.json(
      { code: 'ACCOUNT_NOT_ACTIVATED', message: 'Activate your account via the invite link.' },
      { status: 403 }
    );
  }

  const hashToCompare = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
  const ok = await bcrypt.compare(password, hashToCompare);

  if (!user || !ok) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }, { status: 401 });
  }

  let partnerRole: 'admin' | 'manager' | undefined;
  let assignedOrgIds: string[] | undefined;

  if (user.role === 'partner' && user.partnerId) {
    const membership = await prisma.partnerUser.findUnique({
      where: { partnerId_userId: { partnerId: user.partnerId, userId: user.id } }
    });

    if (membership) {
      if (!membership.isActive) {
        return NextResponse.json({ code: 'ACCOUNT_DEACTIVATED', message: 'Account deactivated' }, { status: 403 });
      }
      partnerRole = membership.roleInPartner === 'admin' ? 'admin' : 'manager';
      assignedOrgIds = membership.assignedOrgIds;
    }
  }

  let organizationMemberships: OrganizationMembership[] | undefined;

  if (user.role === 'organization') {
    const memberships = await prisma.organizationUser.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true, roleInOrg: true, isActive: true }
    });

    organizationMemberships = memberships.map((m) => ({
      organizationId: m.organizationId,
      // Must preserve every role in OrgRoleInOrg — narrowing 'leader' to 'member'
      // here silently disables the leader feature for the whole token lifetime.
      roleInOrg:
        m.roleInOrg === 'admin' ? 'admin' : m.roleInOrg === 'leader' ? 'leader' : 'member',
      isActive: m.isActive
    }));
  }

  let managedOrgIds: string[] | undefined;
  let managerRole: 'leader' | null | undefined;

  if (user.role === 'manager') {
    const assigned = await prisma.organizationManager.findMany({
      where: { userId: user.id, isActive: true },
      select: { organizationId: true }
    });
    managedOrgIds = assigned.map((a) => a.organizationId);
    // Preserve 'leader' explicitly. Mirrors the org-membership narrowing warning
    // above: collapsing this to null silently kills the leader feature for the
    // whole 7d token lifetime.
    managerRole = user.managerRole === 'leader' ? 'leader' : null;
  }

  const token = await signToken({
    sub: user.id,
    role: user.role,
    companyId: user.companyId,
    partnerId: user.partnerId,
    organizationId: user.organizationId,
    email: user.email,
    name: user.name,
    externalStudentId: user.externalStudentId,
    ...(partnerRole !== undefined ? { partnerRole } : {}),
    ...(assignedOrgIds !== undefined ? { assignedOrgIds } : {}),
    ...(organizationMemberships !== undefined ? { organizationMemberships } : {}),
    ...(managedOrgIds !== undefined ? { managedOrgIds } : {}),
    ...(managerRole !== undefined ? { managerRole } : {})
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Align the cookie lifetime with the 7d JWT expiry. Without maxAge this is a
    // session cookie (cleared on browser close), so the effective session
    // lifetime diverged from the token it carries.
    maxAge: 60 * 60 * 24 * 7
  });
  return res;
}
