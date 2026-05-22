import type { SessionPayload } from '@/lib/auth/jwt';

/**
 * Prisma where-fragment that hides ClamAV-flagged files from partner / org /
 * manager queries. Platform admins still see infected rows for forensics.
 *
 * Apply to Document.scanStatus and LeadAttachment.scanStatus columns.
 */
export const INFECTED_HIDDEN_WHERE = {
  scanStatus: { not: 'infected' as const },
};

/**
 * Returns the where-fragment for the given session: an empty object for
 * platform admins (see everything), `INFECTED_HIDDEN_WHERE` for everyone else.
 */
export function hideInfectedForSession(
  session: Pick<SessionPayload, 'role'>,
): { scanStatus?: { not: 'infected' } } {
  return session.role === 'admin' ? {} : INFECTED_HIDDEN_WHERE;
}
