'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { pushLeadToOneC } from '@/lib/services/manager/leadPush';

const PushSchema = z.object({ leadId: z.string().min(1).max(64) });

export type PushLeadToOneCActionResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'not_found' | 'already_pushed' | 'queue_unavailable' };

/**
 * B3: ручная отправка лида в 1С. Тонкий адаптер: форма входа (zod →
 * `validation`), гард роли и ревалидация карточки — здесь; чтение лида,
 * идемпотентность и постановка джобы — в `pushLeadToOneC`
 * (src/lib/services/manager/leadPush.ts).
 */
export async function pushLeadToOneCAction(input: {
  leadId: string;
}): Promise<PushLeadToOneCActionResult> {
  const parsed = PushSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const result = await pushLeadToOneC(prisma, session, { leadId: parsed.data.leadId });
  if (!result.ok) return result;

  revalidatePath(`/manager/leads/${parsed.data.leadId}`);
  return { ok: true };
}
