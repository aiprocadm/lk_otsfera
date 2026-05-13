import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { signToken } from '@/lib/auth/jwt';

export default async function StudentRedirectPage() {
  const session = await getSession();
  if (!session) return null;

  const externalUrl = process.env.STUDENT_PORTAL_URL;
  if (!externalUrl) return <div className='p-6'>STUDENT_PORTAL_URL не настроен</div>;

  const bridge = await signToken({
    sub: session.sub,
    role: 'student',
    organizationId: session.organizationId,
    email: session.email,
    name: session.name
  });

  const url = new URL(externalUrl);
  url.searchParams.set('token', bridge);
  url.searchParams.set('email', session.email ?? '');
  url.searchParams.set('name', session.name ?? '');
  url.searchParams.set('organizationId', session.organizationId ?? '');

  redirect(url.toString());
}
