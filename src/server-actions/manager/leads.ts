'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { recordAudit } from '@/lib/auth/audit';
import { getQueue } from '@/lib/jobs/queues';
import type { PushLeadJobPayload } from '@/lib/jobs/types';
import { log } from '@/lib/logging';

const PushSchema = z.object({ leadId: z.string().min(1).max(64) });

export type PushLeadToOneCActionResult =
  | { ok: true }
  | { ok: false; error: 'validation' | 'not_found' | 'already_pushed' | 'queue_error' };

/**
 * B3: ручная отправка лида в 1С — продюсер очереди oneCSync.pushLead.
 * Лиды — shared queue (решение владельца): пушить может любой менеджер,
 * ownership-проверки нет — как и у остальных lead-операций (requireManager only).
 * Идемпотентность тройная: guard pushedToOneCAt здесь + детерминированный jobId
 * + атомарный claim в сервисе воркера (push-lead.ts, НЕ трогаем).
 */
export async function pushLeadToOneCAction(input: {
  leadId: string;
}): Promise<PushLeadToOneCActionResult> {
  const parsed = PushSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManager();

  const lead = await prisma.lead.findUnique({
    where: { id: parsed.data.leadId },
    select: { id: true, pushedToOneCAt: true }
  });
  if (!lead) return { ok: false, error: 'not_found' };
  if (lead.pushedToOneCAt) return { ok: false, error: 'already_pushed' };

  // try/catch, а не .catch(): getQueue → getRedisConnection бросает СИНХРОННО
  // при отсутствующем REDIS_URL (см. api/integrations/mango/webhook). Сбой
  // enqueue не роняет страницу — деградирует в стабильный код queue_error.
  try {
    const payload: PushLeadJobPayload = { leadId: lead.id };
    await getQueue('oneCSync.pushLead').add('push', payload, { jobId: `push-lead:${lead.id}` });
  } catch (err) {
    log.error('[manager/leads] push lead enqueue failed', {
      leadId: lead.id,
      error: err instanceof Error ? err.message : String(err)
    });
    return { ok: false, error: 'queue_error' };
  }

  await recordAudit(prisma, {
    action: 'lead_push_enqueued',
    entity: 'lead',
    entityId: lead.id,
    userId: session.sub
  });

  revalidatePath(`/manager/leads/${lead.id}`);
  return { ok: true };
}
