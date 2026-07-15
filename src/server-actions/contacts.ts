'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import { bindCall, type BindCallArgs, type BindCallResult } from '@/lib/services/telephony/bindCall';
import { createContact, type CreateContactResult } from '@/lib/services/manager/contacts';

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
 */
export async function createContactFromCallAction(
  args: CreateContactFromCallArgs
): Promise<CreateContactResult> {
  if (notFoundIfDisabled('contacts')) return { ok: false, error: 'forbidden' };
  const session = await requireManager();
  const created = await createContact(prisma, session, {
    name: args.name,
    organizationId: args.organizationId,
    channels: [{ type: 'phone', value: args.phone }]
  });
  if (!created.ok) return created;
  await bindCall(prisma, session, {
    callId: args.callId,
    organizationId: args.organizationId,
    contactId: created.contactId
  });
  return created;
}
