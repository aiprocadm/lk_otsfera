'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { activeOrgIds } from '@/lib/auth/organizationPolicy';
import { updateOrgStudentPosition } from '@/lib/services/organization/students';

export type UpdateStudentPositionResult =
  | { ok: true }
  | { ok: false; error: 'forbidden' | 'validation' };

/**
 * Правка должности сотрудника из его карточки (этап 9 PR-3, ФТ-12.2).
 * Тонкий адаптер над сервисом (§2/§3): роль + принадлежность организации
 * сессии, дальше скоуп держит сам сервис (чужой сотрудник → forbidden).
 */
export async function updateStudentPositionAction(
  formData: FormData
): Promise<UpdateStudentPositionResult> {
  const session = await getSession();
  if (!session || session.role !== 'organization') return { ok: false, error: 'forbidden' };

  const organizationId = String(formData.get('organizationId') ?? '');
  const studentId = String(formData.get('studentId') ?? '');
  if (!organizationId || !studentId) return { ok: false, error: 'validation' };
  if (!activeOrgIds(session).includes(organizationId)) return { ok: false, error: 'forbidden' };

  const res = await updateOrgStudentPosition(prisma, {
    organizationId,
    studentId,
    position: String(formData.get('position') ?? '')
  });
  if (!res.ok) return res;

  revalidatePath(`/organization/students/${studentId}`);
  return { ok: true };
}
