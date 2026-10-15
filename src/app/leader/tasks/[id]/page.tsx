import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getTaskDetail } from '@/lib/services/tasks/detail';
import { TaskPageScreen } from '@/components/tasks/task-page-screen';
import { TaskEditButton } from '@/components/tasks/task-edit-button';
import { getTaskEditForm } from '@/lib/services/tasks/board';
import { missingObjectHref } from '@/lib/navigation/missingObject';

export const dynamic = 'force-dynamic';

/**
 * Карточка задачи в кабинете руководителя (`У-218`) — зеркало менеджерской
 * (§0.2, правило зеркала): один и тот же экран, различается только набор
 * задач, которые роль видит. У администратора задач нет — записанное
 * исключение зеркала. Чужая или несуществующая задача — список с плашкой
 * «объект недоступен» (`У-232`), как у менеджера.
 */
export default async function LeaderTaskPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManagerLeader();
  const { id } = await params;

  const result = await getTaskDetail(prisma, session, id);
  if (!result.ok) redirect(missingObjectHref('/leader/tasks'));

  // Этап 5 ТЗ 13.10.2026 (`У-302`): правка со страницы задачи — той же формой,
  // что на доске; данные и охват даёт сервис доски.
  const edit = await getTaskEditForm(prisma, session, id);
  return (
    <TaskPageScreen
      task={result.task}
      cabinet="leader"
      edit={
        edit.ok ? (
          <TaskEditButton
            card={edit.card}
            columns={edit.columns}
            options={edit.options}
            listHref="/leader/tasks"
          />
        ) : null
      }
    />
  );
}
