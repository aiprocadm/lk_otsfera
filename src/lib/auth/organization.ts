import { prisma } from '@/lib/db/prisma';
import type { SessionPayload } from '@/lib/auth/jwt';

export async function getPrimaryOrganizationId(session: SessionPayload): Promise<string | null> {
  if (session.organizationId) return session.organizationId;

  const membership = await prisma.organizationUser.findFirst({
    where: { userId: session.sub, isActive: true },
    select: { organizationId: true },
    orderBy: { createdAt: 'asc' }
  });

  return membership?.organizationId ?? null;
}
