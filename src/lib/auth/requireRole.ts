import { redirect } from 'next/navigation';
import { getSession } from './session';
import type { SessionPayload } from './jwt';

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  if (session.role !== 'admin') redirect('/forbidden');
  return session;
}

export async function requirePartnerAdmin(): Promise<SessionPayload> {
  const session = await requireSession();
  const isPartnerAdmin =
    session.role === 'partner' && session.partnerRole === 'admin';
  if (!isPartnerAdmin) redirect('/forbidden');
  return session;
}
