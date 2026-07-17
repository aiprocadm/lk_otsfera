'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireAdmin } from '@/lib/auth/requireRole';
import { requeueDeadRecord, type RequeueDeadRecordResult } from '@/lib/services/admin/pendingRecords';

type Validation = { ok: false; error: 'validation' };

function readField(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === 'string' ? v : '';
}

const requeueSchema = z.object({ id: z.string().min(1) });

export async function requeuePendingRecordAction(
  fd: FormData
): Promise<RequeueDeadRecordResult | Validation> {
  const parsed = requeueSchema.safeParse({ id: readField(fd, 'id') });
  if (!parsed.success) return { ok: false, error: 'validation' };
  const session = await requireAdmin();
  const result = await requeueDeadRecord(prisma, session, parsed.data.id);
  revalidatePath('/admin/sync');
  return result;
}
