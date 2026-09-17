'use server';

import { revalidatePath } from 'next/cache';
import { str } from '@/lib/actions/form';
import { prisma } from '@/lib/db/prisma';
import { requireOrganization } from '@/lib/auth/requireRole';
import { setOrgMemberScope } from '@/lib/services/organization/memberScope';

/**
 * `У-236` — переключатель «участники видят только свои заказы». Тонкий
 * адаптер (§3): право администратора организации проверяет сервис.
 */
export type MemberScopeActionResult =
  { ok: true } | { ok: false; error: 'forbidden' | 'not_found' | 'validation' };

export async function setOrgMemberScopeAction(fd: FormData): Promise<MemberScopeActionResult> {
  const session = await requireOrganization();
  const organizationId = str(fd, 'organizationId');
  if (!organizationId) return { ok: false, error: 'validation' };
  const res = await setOrgMemberScope(prisma, session, organizationId, str(fd, 'value') === 'on');
  if (!res.ok) return res;
  revalidatePath('/organization/company');
  revalidatePath('/organization/orders');
  revalidatePath('/organization/dashboard');
  return { ok: true };
}
