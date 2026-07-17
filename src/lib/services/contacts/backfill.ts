import type { PrismaClient, ContactChannelType } from '@prisma/client';
import { normalizeChannelValue } from './resolveContactByChannel';
import { log } from '@/lib/logging';

type ChannelSeed = { type: ContactChannelType; value: string };

/**
 * One-time, idempotent backfill: seeds `Contact` + `ContactChannel` from
 * existing organization-role `User`s and `Lead`s. Dedup key is
 * `(companyId, type, normalizedValue)` — matches the ContactChannel unique
 * constraint. Safe to re-run: a second run creates nothing new because every
 * existing channel value is read into `seen` up front. Wired into
 * `prisma/seed.ts` to run after seeding demo data.
 */
export async function backfillContacts(
  prisma: PrismaClient
): Promise<{ contactsCreated: number; channelsCreated: number }> {
  let contactsCreated = 0;
  let channelsCreated = 0;
  const seen = new Map<string, string>();
  // phone and whatsapp share one number space (see resolveContactByChannel's
  // phoneLike widening) — a Lead phone matching a User's whatsapp must collapse
  // to a single channel row, so both types bucket under the same dedup key.
  const bucket = (type: ContactChannelType): string => (type === 'phone' || type === 'whatsapp' ? 'phoneLike' : type);
  const key = (companyId: string, type: ContactChannelType, nv: string) => `${companyId}|${bucket(type)}|${nv}`;
  for (const ch of await prisma.contactChannel.findMany({
    select: { companyId: true, type: true, normalizedValue: true, contactId: true },
  })) {
    seen.set(key(ch.companyId, ch.type, ch.normalizedValue), ch.contactId);
  }

  async function ensureChannel(companyId: string, contactId: string, seed: ChannelSeed): Promise<void> {
    const nv = normalizeChannelValue(seed.type, seed.value);
    if (!nv) return;
    if (seen.has(key(companyId, seed.type, nv))) return;
    await prisma.contactChannel.create({
      data: { contactId, companyId, type: seed.type, value: seed.value, normalizedValue: nv },
    });
    seen.set(key(companyId, seed.type, nv), contactId);
    channelsCreated++;
  }

  const users = await prisma.user.findMany({
    where: { role: 'organization', organization: { is: { companyId: { not: null } } } },
    select: {
      id: true,
      name: true,
      whatsappPhone: true,
      telegramChatId: true,
      maxChatId: true,
      email: true,
      organizationId: true,
      organization: { select: { companyId: true } },
    },
  });
  for (const u of users) {
    const companyId = u.organization?.companyId;
    /* v8 ignore next -- unreachable: `users` query already filters organization.companyId not-null, so this is a defensive TS-narrowing guard only */
    if (!companyId) continue;
    const seeds: ChannelSeed[] = [];
    if (u.whatsappPhone) seeds.push({ type: 'whatsapp', value: u.whatsappPhone });
    if (u.telegramChatId) seeds.push({ type: 'telegram', value: u.telegramChatId });
    if (u.maxChatId) seeds.push({ type: 'max', value: u.maxChatId });
    if (u.email) seeds.push({ type: 'email', value: u.email });
    const anyNew = seeds.some((s) => {
      const nv = normalizeChannelValue(s.type, s.value);
      return !!nv && !seen.has(key(companyId, s.type, nv));
    });
    if (!anyNew) continue;
    const contact = await prisma.contact.create({
      data: { companyId, organizationId: u.organizationId, userId: u.id, name: u.name },
    });
    contactsCreated++;
    for (const s of seeds) await ensureChannel(companyId, contact.id, s);
  }

  const leads = await prisma.lead.findMany({
    where: { OR: [{ clientContactPhone: { not: null } }, { clientContactEmail: { not: null } }] },
    select: {
      id: true,
      clientContactName: true,
      clientContactPhone: true,
      clientContactEmail: true,
      organizationId: true,
      organization: { select: { companyId: true } },
    },
  });
  for (const l of leads) {
    const companyId = l.organization?.companyId;
    if (!companyId) continue;
    const seeds: ChannelSeed[] = [];
    if (l.clientContactPhone) seeds.push({ type: 'phone', value: l.clientContactPhone });
    if (l.clientContactEmail) seeds.push({ type: 'email', value: l.clientContactEmail });
    const newSeeds = seeds.filter((s) => {
      const nv = normalizeChannelValue(s.type, s.value);
      return !!nv && !seen.has(key(companyId, s.type, nv));
    });
    if (newSeeds.length === 0) continue;
    const contact = await prisma.contact.create({
      data: { companyId, organizationId: l.organizationId, name: l.clientContactName || 'Контакт' },
    });
    contactsCreated++;
    for (const s of newSeeds) await ensureChannel(companyId, contact.id, s);
  }

  log.info('[contacts/backfill] complete', { contactsCreated, channelsCreated });
  return { contactsCreated, channelsCreated };
}
