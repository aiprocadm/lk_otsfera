import { cookies } from 'next/headers';
import { verifyToken } from './jwt';
import { prisma } from '@/lib/db/prisma';

export async function getSession() {
  const token = (await cookies()).get('session')?.value;
  if (!token) return null;
  try {
    const payload = await verifyToken(token);
    if (!payload.sub) return null;
    // Partner.isActive is intentionally not checked here — partner deactivation
    // is enforced via TTL on the next JWT issue, see admin partners flow.
    const user = await prisma.user.findUnique({ where: { id: payload.sub }, select: { isActive: true } });
    if (!user || !user.isActive) return null;
    return payload;
  } catch {
    return null;
  }
}
