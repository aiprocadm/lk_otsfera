import type { PrismaClient } from '@prisma/client';
import type { SessionPayload } from '@/lib/auth/jwt';
import { recordPiiAccess } from '@/lib/pii/record';
import { resolveContactByChannel } from './resolveContactByChannel';
import { canUseContacts, isContactInScope } from './scope';

export type LeadContactMatch = { id: string; name: string };

/**
 * Контакт, к которому относится лид (`У-180`, спека 04 §«карточка лида»):
 * ищем по телефону заявки, затем по почте — тем же `resolveContactByChannel`,
 * что связывает звонки и письма. Совпадение принимается только если контакт в
 * охвате сотрудника (`isContactInScope`): резолвер компанией не ограничен, а
 * человек из чужой компании на карточке лида — утечка. Нет совпадения — `null`,
 * и карточка предлагает «Создать контакт из данных лида».
 */
export async function findLeadContact(
  prisma: PrismaClient,
  session: SessionPayload,
  teamMode: boolean,
  lead: { clientContactPhone: string | null; clientContactEmail: string | null }
): Promise<LeadContactMatch | null> {
  if (!canUseContacts(session)) return null;
  const byPhone = lead.clientContactPhone
    ? await resolveContactByChannel(prisma, {
        type: 'phone',
        value: lead.clientContactPhone,
        phoneLike: true,
      })
    : null;
  const hit =
    byPhone ??
    (lead.clientContactEmail
      ? await resolveContactByChannel(prisma, { type: 'email', value: lead.clientContactEmail })
      : null);
  if (!hit || !isContactInScope(session, teamMode, hit)) return null;

  const contact = await prisma.contact.findUnique({
    where: { id: hit.contactId },
    select: { id: true, name: true },
  });
  if (!contact) return null;
  await recordPiiAccess(prisma, {
    session,
    context: 'lead_contact_match',
    subjectIds: [contact.id],
  });
  return contact;
}
