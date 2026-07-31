import type { PrismaClient } from '@prisma/client';
import { normalizePhoneCanonical } from '@/lib/phone/normalize';
import { resolveContactByChannel } from '@/lib/services/contacts/resolveContactByChannel';

/** @deprecated use normalizePhoneCanonical; kept as a thin alias (M2 unification). */
export function canonicalizeRuPhone(raw: string): string {
  return normalizePhoneCanonical(raw);
}

export type CallerResolution =
  | { matchType: 'exact'; userId?: string; orgId: string; companyId: string; contactId?: string }
  | {
      matchType: 'unresolved';
      userId?: undefined;
      orgId?: undefined;
      companyId?: undefined;
      contactId?: undefined;
    };

export async function resolveCaller(
  prisma: PrismaClient,
  phoneRaw: string
): Promise<CallerResolution> {
  const phone = canonicalizeRuPhone(phoneRaw);
  if (!phone || phone === '+') return { matchType: 'unresolved' };

  // 1) Contact-first: prefer a ContactChannel match (phone-like: {phone, whatsapp})
  // over the legacy User exact-match. An org-less contact hit does NOT
  // short-circuit — call attribution needs an org to bind, so it falls
  // through to the User/Lead paths below.
  const hit = await resolveContactByChannel(prisma, {
    type: 'phone',
    value: phone,
    phoneLike: true,
  });
  if (hit && hit.organizationId) {
    return {
      matchType: 'exact',
      orgId: hit.organizationId,
      companyId: hit.companyId,
      contactId: hit.contactId,
      ...(hit.userId ? { userId: hit.userId } : {}),
    };
  }

  // 2) exact unique User.whatsappPhone
  const users = await prisma.user.findMany({
    where: { whatsappPhone: phone },
    select: { id: true, organization: { select: { id: true, companyId: true } } },
    take: 2,
  });
  if (users.length === 1 && users[0].organization?.id && users[0].organization.companyId) {
    return {
      matchType: 'exact',
      userId: users[0].id,
      orgId: users[0].organization.id,
      companyId: users[0].organization.companyId,
    };
  }
  if (users.length > 1) return { matchType: 'unresolved' }; // ambiguous → never guess

  // 3) fallback: exact Lead.clientContactPhone
  const leads = await prisma.lead.findMany({
    where: { clientContactPhone: phone },
    select: { organizationId: true, organization: { select: { companyId: true } } },
    take: 2,
  });
  if (leads.length === 1 && leads[0].organizationId && leads[0].organization?.companyId) {
    return {
      matchType: 'exact',
      orgId: leads[0].organizationId,
      companyId: leads[0].organization.companyId,
    };
  }

  return { matchType: 'unresolved' };
}
