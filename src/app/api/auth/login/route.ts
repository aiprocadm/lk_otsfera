import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import bcrypt from 'bcryptjs';
import { signToken, type OrganizationMembership } from '@/lib/auth/jwt';
import { toSessionAccessProfile, type SessionAccessProfile } from '@/lib/auth/accessProfile';
import { isRateLimited } from '@/lib/rateLimit';

const DUMMY_BCRYPT_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256)
});

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_ATTEMPTS = Number(process.env.LOGIN_RATE_LIMIT_MAX ?? 10);

// Общий Redis-backed лимитер (@/lib/rateLimit): счётчик делится между всеми
// инстансами и переживает cold start; при недоступном Redis сам деградирует
// в in-memory. Ключ по IP: реальность x-forwarded-for обеспечивает
// reverse-proxy (перезапись XFF — требование release-чеклиста, как и для
// Mango IP-allowlist).
function clientIp(req: Request): string {
  const headers = req.headers;
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  const ip = clientIp(req);

  if (await isRateLimited(`login:${ip}`, { windowMs: WINDOW_MS, max: MAX_ATTEMPTS })) {
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
  let accessProfile: SessionAccessProfile | undefined;

  if (user.role === 'manager') {
    // C8 company floor: a manager's scope is bounded by their own company.
    // Without the `organization.companyId === user.companyId` filter, a stale or
    // legacy cross-company OrganizationManager row would widen managedOrgIds
    // beyond the isolation boundary (see CLAUDE.md §4). A manager with no
    // companyId is the deny-null sentinel — resolve zero orgs and skip the query.
    const assigned = user.companyId
      ? await prisma.organizationManager.findMany({
          where: { userId: user.id, isActive: true, organization: { companyId: user.companyId } },
          select: { organizationId: true }
        })
      : [];
    managedOrgIds = assigned.map((a) => a.organizationId);
    // Preserve 'leader' explicitly. Mirrors the org-membership narrowing warning
    // above: collapsing this to null silently kills the leader feature for the
    // whole 7d token lifetime.
    managerRole = user.managerRole === 'leader' ? 'leader' : null;
    // G1: денормализуем кастомный профиль доступа в токен (single indexed lookup,
    // как managedOrgIds). null accessProfileId → профиля нет → legacy-поведение.
    if (user.accessProfileId) {
      const row = await prisma.accessProfile.findUnique({ where: { id: user.accessProfileId } });
      if (row) accessProfile = toSessionAccessProfile(row);
    }
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
    ...(managerRole !== undefined ? { managerRole } : {}),
    ...(accessProfile !== undefined ? { accessProfile } : {})
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
