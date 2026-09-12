'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import type { SessionPayload } from '@/lib/auth/jwt';
import { requireManager, requireSession } from '@/lib/auth/requireRole';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  addChannel,
  archiveContact,
  removeChannel,
  restoreContact,
  setPrimaryChannel,
  updateContact,
  type MutateContactResult,
} from '@/lib/services/contacts/mutate';
import {
  listMergeCandidates,
  mergeContacts,
  type MergeContactsResult,
} from '@/lib/services/contacts/merge';
import {
  bindCall,
  type BindCallArgs,
  type BindCallResult,
} from '@/lib/services/telephony/bindCall';
import { createContact } from '@/lib/services/manager/contacts';
import type { ChannelOwner } from '@/lib/services/contacts/channels';
import {
  createContactFromInbound,
  type CreateContactFromInboundArgs,
  type CreateContactFromInboundResult,
} from '@/lib/services/inbound/createContactFromInbound';

/**
 * Thin adapter over `bindCall` (src/lib/services/telephony/bindCall.ts) — binds
 * an unresolved call to an org/contact/order. Gated by the `contacts` feature
 * flag (PR-A: triage actions; the /manager/contacts screen itself lands in PR-B).
 */
export async function bindCallAction(args: BindCallArgs): Promise<BindCallResult> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  return bindCall(prisma, session, args);
}

export type CreateContactFromCallArgs = {
  callId: string;
  organizationId: string;
  name: string;
  phone: string;
};

/**
 * Creates a new contact from a call's caller identity, then binds the call to
 * it. `createContact` writes the phone as the contact's primary channel, so
 * `bindCall`'s learn-on-link capture is a no-op for this number — it's already
 * there.
 *
 * A bind failure is surfaced (e.g. `'not_found'` if the call vanished): the
 * created contact is itself valid and org-scoped, so no rollback is needed, but
 * the caller must know the CALL wasn't attributed.
 */
export async function createContactFromCallAction(
  args: CreateContactFromCallArgs
): Promise<
  | { ok: true; contactId: string }
  | { ok: false; error: 'forbidden' | 'invalid' | 'not_found' }
  | { ok: false; error: 'contact_channel_taken'; conflict: ChannelOwner }
> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  const created = await createContact(prisma, session, {
    name: args.name,
    organizationId: args.organizationId,
    channels: [{ type: 'phone', value: args.phone }],
  });
  if (!created.ok) return created;
  const bound = await bindCall(prisma, session, {
    callId: args.callId,
    organizationId: args.organizationId,
    contactId: created.contactId,
  });
  if (!bound.ok) return { ok: false, error: bound.error };
  return created;
}

export type { CreateContactFromInboundArgs };

/**
 * Тонкий адаптер над `createContactFromInbound`
 * (src/lib/services/inbound/createContactFromInbound.ts): флаг и гард роли —
 * здесь, вся цепочка «найти письмо → создать контакт → привязать» — в сервисе
 * (цельная операция, чтобы порядок побочных эффектов не размазался по слоям).
 */
export async function createContactFromInboundAction(
  args: CreateContactFromInboundArgs
): Promise<CreateContactFromInboundResult> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  return createContactFromInbound(prisma, session, args);
}

// ─── Этап 1 ТЗ 12.09.2026, PR-1 «основа» (`У-180`, `У-181`) ──────────────────
// Тонкие адаптеры над сервисами правок и объединения: флаг и форма — здесь,
// роль, скоуп и запись — в сервисах (`canUseContacts` отказывает клиентскому
// контуру, `isContactInScope` — чужому). `teamMode` читается свежим из базы
// (C8); экраны трёх кабинетов ЦО (PR-2) перечитываются `revalidatePath`.

const IdSchema = z.string().min(1).max(64);
const ChannelTypeSchema = z.enum(['phone', 'email', 'telegram', 'whatsapp', 'max']);

type Validation = { ok: false; error: 'validation' };
type Disabled = { ok: false; error: 'forbidden' };

function contactsDisabled(): Disabled | null {
  return notFoundIfDisabled('contacts') ? { ok: false, error: 'forbidden' } : null;
}

/** `teamMode` читается свежим из базы (C8); гард сессии стоит в каждом действии — страж `server-actions.session-guard` смотрит на тело действия, а не на помощников. */
function teamModeOf(session: SessionPayload): Promise<boolean> {
  return getCompanyTeamVisibility(prisma, session.companyId);
}

/** Контакт виден в трёх кабинетах ЦО и в карточке его организации — перечитываем все. */
function revalidateContact(contactId: string, organizationId?: string | null): void {
  for (const cabinet of ['manager', 'leader', 'admin']) {
    revalidatePath(`/${cabinet}/contacts`);
    revalidatePath(`/${cabinet}/contacts/${contactId}`);
    if (organizationId) revalidatePath(`/${cabinet}/organizations/${organizationId}`);
  }
}

const UpdateContactSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(200),
  position: z.string().max(200).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
  organizationId: IdSchema.nullable().optional(),
});

export async function updateContactAction(
  input: z.input<typeof UpdateContactSchema>
): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = UpdateContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await updateContact(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId, parsed.data.organizationId);
  return result;
}

export async function archiveContactAction(input: {
  id: string;
}): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = z.object({ id: IdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await archiveContact(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId);
  return result;
}

export async function restoreContactAction(input: {
  id: string;
}): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = z.object({ id: IdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await restoreContact(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId);
  return result;
}

const AddChannelSchema = z.object({
  contactId: IdSchema,
  type: ChannelTypeSchema,
  value: z.string().min(1).max(200),
  makePrimary: z.boolean().optional(),
});

export async function addChannelAction(
  input: z.input<typeof AddChannelSchema>
): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = AddChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await addChannel(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId);
  return result;
}

export async function removeChannelAction(input: {
  channelId: string;
}): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = z.object({ channelId: IdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await removeChannel(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId);
  return result;
}

export async function setPrimaryChannelAction(input: {
  channelId: string;
}): Promise<MutateContactResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = z.object({ channelId: IdSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await setPrimaryChannel(prisma, session, teamMode, parsed.data);
  if (result.ok) revalidateContact(result.contactId);
  return result;
}

const MergeSchema = z.object({ primaryId: IdSchema, secondaryId: IdSchema });

export async function mergeContactsAction(input: {
  primaryId: string;
  secondaryId: string;
}): Promise<MergeContactsResult | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = MergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  const result = await mergeContacts(prisma, session, teamMode, parsed.data);
  if (result.ok) {
    // Второй контакт тоже перечитываем: его страница теперь редиректит.
    revalidateContact(result.primaryId);
    revalidateContact(parsed.data.secondaryId);
  }
  return result;
}

const CandidatesSchema = z.object({ excludeId: IdSchema, q: z.string().max(100).optional() });

/** Кандидаты для диалога «Объединить» — поиск по мере ввода. */
export async function listMergeCandidatesAction(input: {
  excludeId: string;
  q?: string;
}): Promise<Awaited<ReturnType<typeof listMergeCandidates>> | Validation> {
  const off = contactsDisabled();
  if (off) return off;
  const parsed = CandidatesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireSession();
  const teamMode = await teamModeOf(session);
  return listMergeCandidates(prisma, session, teamMode, parsed.data);
}
