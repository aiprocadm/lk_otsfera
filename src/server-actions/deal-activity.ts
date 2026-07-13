'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { addDealNote, type AddDealNoteResult } from '@/lib/services/manager/dealNotes';

export async function addDealNoteAction(args: { orderId: string; body: string }): Promise<AddDealNoteResult> {
  const session = await requireManager();
  return addDealNote(prisma, session, args);
}
