'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db/prisma';
import { requireSession } from '@/lib/auth/guard';
import { getCompanyTeamVisibility } from '@/lib/auth/managerPolicy';
import { createStudent, type CreateStudentResult } from '@/lib/services/students/crud';
import { str } from '@/lib/actions/form';

/**
 * Добавление сотрудника (`У-24`…`У-26`, `У-63`, этап 5).
 *
 * Тонкий адаптер над сервисом: права и дедупликация — там (CLAUDE.md §3/§4),
 * здесь только разбор формы и обновление затронутых экранов.
 *
 * `teamMode` берётся **свежим из базы** (C8): менеджерский скоуп зависит от
 * настройки видимости команды, и пропуск аргумента молча сузил бы выборку.
 */
export async function createStudentAction(fd: FormData): Promise<CreateStudentResult> {
  const guard = await requireSession();
  if (!guard.ok) return { ok: false, error: 'forbidden' };
  const session = guard.value;

  const organizationId = str(fd, 'organizationId');
  if (!organizationId)
    return { ok: false, error: 'validation', messages: ['Организация не задана'] };

  const rawBirth = str(fd, 'birthDate');
  const birthDate = rawBirth ? new Date(rawBirth) : null;
  if (birthDate && Number.isNaN(birthDate.getTime())) {
    return { ok: false, error: 'validation', messages: ['Дата рождения указана неверно'] };
  }

  const teamMode = session.companyId
    ? await getCompanyTeamVisibility(prisma, session.companyId)
    : false;

  const res = await createStudent(prisma, session, {
    organizationId,
    teamMode,
    name: str(fd, 'name'),
    position: str(fd, 'position'),
    snils: str(fd, 'snils'),
    birthDate,
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    note: str(fd, 'note'),
    force: str(fd, 'force') === '1',
  });

  if (res.ok) {
    // Сотрудник виден из четырёх кабинетов — обновляем все входы разом.
    revalidatePath('/organization/students');
    revalidatePath(`/partner/portfolio/${organizationId}`);
    revalidatePath(`/manager/organizations/${organizationId}`);
    revalidatePath(`/admin/organizations/${organizationId}`);
  }
  return res;
}
