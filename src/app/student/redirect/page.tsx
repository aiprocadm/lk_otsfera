import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signStudentBridgeToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';

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
  // eslint-disable-next-line react-hooks/purity -- server component, Date.now() is safe here
  const expiresAt = new Date(Date.now() + Math.max(10, bridgeCodeTtlSec) * 1000);

  await prisma.$transaction([
    prisma.auditLog.create({
      data: {
        action: 'STUDENT_BRIDGE_TOKEN_ISSUED',
        entity: 'student_bridge_token',
        entityId: jti,
        userId: session.sub,
        meta: { iat, organizationId: session.organizationId, externalStudentId: session.externalStudentId }
      }
    }),
    prisma.studentBridgeGrant.create({
      data: {
        code,
        jti,
        token: bridge,
        userId: session.sub,
        expiresAt
      }
    }),
    prisma.auditLog.create({
      data: {
        action: 'STUDENT_BRIDGE_CODE_ISSUED',
        entity: 'student_bridge_code',
        entityId: jti,
        userId: session.sub,
        meta: { code, expiresAt: expiresAt.toISOString() }
      }
    })
  ]);

  url.searchParams.set('code', code);

  redirect(url.toString());
}
