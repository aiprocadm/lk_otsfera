'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import {
  transitionOrderLifecycle,
  setOrderAccountingSigned
} from '@/lib/services/manager/orderLifecycle';
import type { CompletionCondition } from '@/lib/orders/completion';

const TransitionSchema = z.object({
  orderId: z.string().min(1),
  to: z.enum(['new', 'in_progress', 'waiting_client', 'completed']),
  reason: z.string().max(1000).optional()
});

export type TransitionLifecycleActionResult =
  | { ok: true; changed: boolean; status: string }
  | {
      ok: false;
      error: 'validation' | 'not_found' | 'forbidden' | 'invalid_transition' | 'reason_required';
    }
  | { ok: false; error: 'completion_conditions_unmet'; unmet: CompletionCondition[] };

function revalidateOrder(orderId: string): void {
  revalidatePath(`/manager/orders/${orderId}`);
  revalidatePath('/manager/orders');
  revalidatePath(`/leader/orders/${orderId}`);
  revalidatePath('/leader/orders');
}

export async function transitionOrderLifecycleAction(input: {
  orderId: string;
  to: string;
  reason?: string;
}): Promise<TransitionLifecycleActionResult> {
  const parsed = TransitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation' };
  }

  const session = await requireManager();
  const result = await transitionOrderLifecycle(prisma, session, parsed.data);
  if (!result.ok) return result;

  revalidateOrder(parsed.data.orderId);
  return { ok: true, changed: result.changed, status: result.status };
}

const AccountingSchema = z.object({
  orderId: z.string().min(1),
  signed: z.boolean()
});

export type SetAccountingSignedActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'not_found' | 'forbidden' };

export async function setOrderAccountingSignedAction(input: {
  orderId: string;
  signed: boolean;
}): Promise<SetAccountingSignedActionResult> {
  const parsed = AccountingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'validation' };
  }

  const session = await requireManager();
  const result = await setOrderAccountingSigned(prisma, session, parsed.data);
  if (!result.ok) return result;

  revalidateOrder(parsed.data.orderId);
  return { ok: true, changed: result.changed };
}
