'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { setTeamVisibility } from '@/lib/services/manager/teamVisibility';

const InputSchema = z.object({ enabled: z.boolean() });

export type SetTeamVisibilityResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: 'validation' | 'no_company' };

export async function setTeamVisibilityAction(input: {
  enabled: boolean;
}): Promise<SetTeamVisibilityResult> {
  const parsed = InputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireManagerLeader();
  if (!session.companyId) return { ok: false, error: 'no_company' };

  const result = await setTeamVisibility(prisma, session.sub, session.companyId, parsed.data.enabled);
  revalidatePath('/manager/team');
  revalidatePath('/manager/dashboard');
  return { ok: true, changed: result.changed };
}
