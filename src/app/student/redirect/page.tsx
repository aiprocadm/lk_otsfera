import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signStudentBridgeToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';
import { recordAudit } from '@/lib/auth/audit';

const bridgeCodeTtlSec = Number(process.env.STUDENT_BRIDGE_CODE_TTL_SEC ?? 60);

function parseCsvHosts(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
    .filter(host => !host.includes('*'));
}

function getStudentRedirectConfig() {
  const newRedirectUrl = process.env.STUDENT_REDIRECT_URL?.trim();
  const legacyRedirectUrl = process.env.STUDENT_PORTAL_URL?.trim();
  const redirectUrl = newRedirectUrl || legacyRedirectUrl;

  if (!newRedirectUrl && legacyRedirectUrl) {
    console.warn(
      '[student-redirect] STUDENT_PORTAL_URL is deprecated. Please migrate to STUDENT_REDIRECT_URL.'
    );
  }

  const newAllowlist = process.env.STUDENT_REDIRECT_ALLOWED_DOMAINS;
  const legacyAllowlist = process.env.STUDENT_PORTAL_ALLOWED_HOSTS;
  const allowlistRaw = (newAllowlist && newAllowlist.trim()) || legacyAllowlist;

  if ((!newAllowlist || !newAllowlist.trim()) && legacyAllowlist) {
    console.warn(
      '[student-redirect] STUDENT_PORTAL_ALLOWED_HOSTS is deprecated. Please migrate to STUDENT_REDIRECT_ALLOWED_DOMAINS.'
    );
  }

  return {
    redirectUrl,
    allowlist: ['otsfera.cdoprof.com', ...parseCsvHosts(allowlistRaw)]
  };
}

export default async function StudentRedirectPage() {
  const session = await getSession();
  if (!session) return null;
  // Defense-in-depth: this page mints a bridge token with role:'student'
  // hard-coded. Middleware also lets organization/manager/admin into /student
  // (shared cabinet entry), so the external SSO handoff itself must be
  // student-only — otherwise a non-student could obtain a student-scoped token.
  if (session.role !== 'student') {
    return <div className='p-6'>Переход в кабинет слушателя доступен только обучающимся.</div>;
  }

  const { redirectUrl: externalUrl, allowlist: studentPortalAllowlist } = getStudentRedirectConfig();
  if (!externalUrl) return <div className='p-6'>STUDENT_REDIRECT_URL не настроен</div>;

  let url: URL;
  try {
    url = assertAllowedStudentPortalUrl(externalUrl, { allowlist: studentPortalAllowlist });
  } catch (error) {
    const parsed = URL.canParse(externalUrl) ? new URL(externalUrl) : null;
    console.error('Blocked student portal redirect URL', {
      reason: error instanceof Error ? error.message : 'Unknown error',
      protocol: parsed?.protocol,
      hostname: parsed?.hostname
    });

    return <div className='p-6'>Не удалось выполнить безопасный переход. Обратитесь в поддержку.</div>;
  }

  const { token: bridge, jti, iat } = await signStudentBridgeToken({
    sub: session.sub,
    role: 'student',
    organizationId: session.organizationId,
    email: session.email,
    name: session.name,
    externalStudentId: session.externalStudentId
  });

  const code = randomUUID();
  // Clamp the one-time code lifetime to [10, 300]s. Guards an operator setting
  // STUDENT_BRIDGE_CODE_TTL_SEC to 0/negative/NaN (→ floor) or an excessively
  // long window (→ ceiling) that would leave a live grant + JWT redeemable for
  // hours.
  const codeTtlSec = Number.isFinite(bridgeCodeTtlSec)
    ? Math.min(300, Math.max(10, bridgeCodeTtlSec))
    : 60;
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is safe here
  const expiresAt = new Date(Date.now() + codeTtlSec * 1000);

  await prisma.$transaction(async (tx) => {
    await recordAudit(tx, {
      action: 'STUDENT_BRIDGE_TOKEN_ISSUED',
      entity: 'student_bridge',
      entityId: jti,
      userId: session.sub,
      after: { iat, organizationId: session.organizationId, externalStudentId: session.externalStudentId },
    });
    await tx.studentBridgeGrant.create({
      data: {
        code,
        jti,
        token: bridge,
        userId: session.sub,
        expiresAt
      }
    });
    await recordAudit(tx, {
      action: 'STUDENT_BRIDGE_CODE_ISSUED',
      entity: 'student_bridge',
      entityId: jti,
      userId: session.sub,
      // SECURITY: never log the one-time bridge code (CLAUDE.md §12). The jti in
      // `entityId` already correlates the grant for forensics.
      after: { expiresAt: expiresAt.toISOString() },
    });
  });

  url.searchParams.set('code', code);

  redirect(url.toString());
}
