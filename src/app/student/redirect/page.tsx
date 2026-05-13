import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signStudentBridgeToken } from '@/lib/auth/jwt';
import { prisma } from '@/lib/db/prisma';

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

  await prisma.auditLog.create({
    data: {
      action: 'STUDENT_BRIDGE_TOKEN_ISSUED',
      entity: 'student_bridge_token',
      entityId: jti,
      userId: session.sub,
      meta: { iat, organizationId: session.organizationId, externalStudentId: session.externalStudentId }
    }
  });

  const url = new URL(externalUrl);
  url.searchParams.set('token', bridge);
  url.searchParams.set('email', session.email ?? '');
  url.searchParams.set('name', session.name ?? '');
  url.searchParams.set('organizationId', session.organizationId ?? '');
  url.searchParams.set('external_student_id', session.externalStudentId ?? '');

  redirect(url.toString());
}
