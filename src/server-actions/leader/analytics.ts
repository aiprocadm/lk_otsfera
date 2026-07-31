'use server';

import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { notFoundIfDisabled } from '@/lib/featureFlags';
import {
  upsertSalesTarget,
  type UpsertSalesTargetArgs,
  type UpsertSalesTargetError,
} from '@/lib/services/leader/analytics';

/**
 * M3 — тонкий server-action поверх upsertSalesTarget (§3 Result-контракт).
 * Флаг-гейт до auth (не палим существование действия при выключенном модуле,
 * тот же порядок что и initiateCallAction в src/server-actions/deal-activity.ts).
 */
export async function upsertSalesTargetAction(
  args: UpsertSalesTargetArgs
): Promise<{ ok: true } | { ok: false; error: UpsertSalesTargetError | 'disabled' }> {
  const disabled = notFoundIfDisabled('leader_analytics');
  if (disabled) return { ok: false as const, error: 'disabled' as const };
  const session = await requireManagerLeader();
  return upsertSalesTarget(prisma, session, args);
}
