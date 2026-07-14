'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { addDealNote, type AddDealNoteResult } from '@/lib/services/manager/dealNotes';
import { initiateOutboundCall, type InitiateCallResult } from '@/lib/services/telephony/initiateCall';
import { notFoundIfDisabled } from '@/lib/featureFlags';

export async function addDealNoteAction(args: { orderId: string; body: string }): Promise<AddDealNoteResult> {
  const session = await requireManager();
  return addDealNote(prisma, session, args);
}

export async function initiateCallAction(args: { orderId: string; toNumber: string; fromInternal: string }): Promise<InitiateCallResult> {
  const disabled = notFoundIfDisabled('telephony_mango');
  if (disabled) return { ok: false, error: 'disabled' };
  const session = await requireManager();
  return initiateOutboundCall(prisma, session, args);
}
