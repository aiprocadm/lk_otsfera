'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/requireRole';
import {
  createOrganizationByManager,
  type CreateOrgByManagerError,
} from '@/lib/services/manager/organizationCreate';

const Schema = z.object({
  name: z.string().max(300),
  inn: z.string().max(20).optional(),
});

/**
 * «Создать организацию» сотрудником (этап 6 ТЗ 13.10.2026, `У-308`, `У-309`).
 * Форма входа — здесь; права, дубли и закрепление за создавшим — в сервисе.
 */
export async function createOrganizationAction(
  input: z.input<typeof Schema>
): Promise<
  | { ok: true; organizationId: string; name: string }
  | { ok: false; error: CreateOrgByManagerError; organizationId?: string }
> {
  const session = await requireSession();
  const parsed = Schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'validation' };
  const res = await createOrganizationByManager(prisma, session, parsed.data);
  if (res.ok) {
    for (const path of ['/manager/organizations', '/manager/contacts', '/admin/contacts']) {
      revalidatePath(path);
    }
  }
  return res;
}
