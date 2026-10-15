import React from 'react';
import { notFound, redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getTaskDetail } from '@/lib/services/tasks/detail';
import { TaskPageScreen } from '@/components/tasks/task-page-screen';
import { TaskEditButton } from '@/components/tasks/task-edit-button';
import { getTaskEditForm } from '@/lib/services/tasks/board';
import { missingObjectHref } from '@/lib/navigation/missingObject';

export const dynamic = 'force-dynamic';

/**
 * Карточка задачи в кабинете менеджера (`У-218`). До этапа 4 задача жила
 * только в модальном окне — открыть её по ссылке было нельзя, а значит нельзя
 * было ни переслать коллеге, ни сослаться из уведомления.
 *
 * Чужая или несуществующая задача — список задач с плашкой «объект
 * недоступен» (`У-232`, спека §3.7), а не 404: сервис не различает их
 * наружу, и страница тоже.
 */
export default async function ManagerTaskPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManager();
  const { id } = await params;

  const result = await getTaskDetail(prisma, session, id);
  if (!result.ok) redirect(missingObjectHref('/manager/tasks'));

  // Этап 5 ТЗ 13.10.2026 (`У-302`): правка со страницы задачи — той же формой,
  // что на доске; данные и охват даёт сервис доски.
  const edit = await getTaskEditForm(prisma, session, id);
  return (
    <TaskPageScreen
      task={result.task}
      cabinet="manager"
      edit={
        edit.ok ? (
          <TaskEditButton
            card={edit.card}
            columns={edit.columns}
            options={edit.options}
            listHref="/manager/tasks"
          />
        ) : null
      }
    />
  );
}
