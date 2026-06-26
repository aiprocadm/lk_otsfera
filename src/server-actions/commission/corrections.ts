'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import { resolveCorrection } from '@/lib/services/commission/corrections';

// RBAC намеренно НЕ здесь: leader = manager + managerRole='leader' (нет top-level
// роли 'leader'), поэтому аутентифицируем requireSession() и отдаём гейт сервису —
// resolveCorrection() сам возвращает 'forbidden' для не-admin/не-leader.
const schema = z.object({
  correctionId: z.string().min(1),
  action: z.enum(['apply', 'waive']),
  reason: z.string().optional()
});

type Result = { ok: true } | { ok: false; error: string };

export async function resolveCorrectionAction(fd: FormData): Promise<Result> {
  const parsed = schema.safeParse({
    correctionId: fd.get('correctionId'),
    action: fd.get('action'),
    reason: (fd.get('reason') as string) || undefined
  });
  if (!parsed.success) return { ok: false, error: 'validation' };

  const session = await requireSession();
  const res = await resolveCorrection(prisma, session, parsed.data);
  if (res.ok) {
    revalidatePath('/admin/commission-corrections');
    revalidatePath('/leader/commission-corrections');
    return { ok: true };
  }
  return { ok: false, error: res.error };
}
