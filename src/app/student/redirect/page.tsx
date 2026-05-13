import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signStudentBridgeToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';
import { assertAllowedStudentPortalUrl } from '@/lib/security/redirect';

const bridgeCodeTtlSec = Number(process.env.STUDENT_BRIDGE_CODE_TTL_SEC ?? 60);

export default async function StudentRedirectPage() {
  const session = await getSession();
  if (!session) return null;

  const externalUrl = process.env.STUDENT_PORTAL_URL;
  if (!externalUrl) return <div className='p-6'>STUDENT_PORTAL_URL не настроен</div>;

  const { token: bridge, jti, iat } = await signStudentBridgeToken({
    sub: session.sub,
    role: 'student',
    organizationId: session.organizationId,
    email: session.email,
    name: session.name,
    externalStudentId: session.externalStudentId
  });

  const code = randomUUID();
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

  let url: URL;
  try {
    url = assertAllowedStudentPortalUrl(externalUrl);
  } catch {
    return <div className='p-6'>Некорректная конфигурация STUDENT_PORTAL_URL</div>;
  }

  url.searchParams.set('code', code);
  redirect(url.toString());
}
