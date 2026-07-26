'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { setSlaSettings } from '@/lib/services/manager/slaSettings';

/** Этап 7 (§4.4, PR-3) — смена порогов SLA компании (гейт как teamVisibility). */

const InputSchema = z.object({
  slaResponseHours: z.coerce.number().int(),
  slaWarningHours: z.coerce.number().int()
});

export type SetSlaSettingsActionResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'no_company' | 'company_not_found'; messages?: string[] };

export async function setSlaSettingsAction(input: {
  slaResponseHours: number;
  slaWarningHours: number;
}): Promise<SetSlaSettingsActionResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!session.companyId) return { ok: false, error: 'no_company' };

  const res = await setSlaSettings(prisma, session.sub, session.companyId, parsed.data);
  if (!res.ok) return res;
  revalidatePath('/leader/team');
  revalidatePath('/leader/intake');
  revalidatePath('/manager/intake');
  return { ok: true, changed: res.changed };
}
