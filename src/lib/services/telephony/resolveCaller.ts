import type { PrismaClient } from '@prisma/client';
import { normalizePhone } from '@/lib/services/inbound/resolve';

// RU-aware canonicalization: Mango often delivers Russian numbers in national
// 8XXXXXXXXXX form; contacts are stored E.164 +7XXXXXXXXXX. Canonicalize a leading
// domestic 8 (11 digits total) to +7 so resolution matches. Do NOT change the shared
// normalizePhone (would ripple into WhatsApp); this canonicalization is telephony-local.
export function canonicalizeRuPhone(raw: string): string {
  const n = normalizePhone(raw); // '+<digits>'
  const digits = n.replace(/^\+/, '');
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  return n;
}

export type CallerResolution =
  | { matchType: 'exact'; userId?: string; orgId: string; companyId: string }
  | { matchType: 'unresolved'; userId?: undefined; orgId?: undefined; companyId?: undefined };

export async function resolveCaller(prisma: PrismaClient, phoneRaw: string): Promise<CallerResolution> {
  const phone = canonicalizeRuPhone(phoneRaw);
  if (!phone || phone === '+') return { matchType: 'unresolved' };

  // 1) exact unique User.whatsappPhone
  const users = await prisma.user.findMany({
    where: { whatsappPhone: phone },
    select: { id: true, organization: { select: { id: true, companyId: true } } },
    take: 2,
  });
  if (users.length === 1 && users[0].organization?.id && users[0].organization.companyId) {
    return { matchType: 'exact', userId: users[0].id, orgId: users[0].organization.id, companyId: users[0].organization.companyId };
  }
  if (users.length > 1) return { matchType: 'unresolved' }; // ambiguous → never guess

  // 2) fallback: exact Lead.clientContactPhone
  const leads = await prisma.lead.findMany({
    where: { clientContactPhone: phone },
    select: { organizationId: true, organization: { select: { companyId: true } } },
    take: 2,
  });
  if (leads.length === 1 && leads[0].organizationId && leads[0].organization?.companyId) {
    return { matchType: 'exact', orgId: leads[0].organizationId, companyId: leads[0].organization.companyId };
  }

  return { matchType: 'unresolved' };
}
