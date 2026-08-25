import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listTaskBoard, getTaskFormOptions } from '@/lib/services/tasks/board';
import { parseTasksSearchParams } from '@/lib/tasks/filters';
import { TaskBoard } from '@/components/tasks/task-board';
import { TaskList } from '@/components/tasks/task-list';
import { TasksToolbar } from '@/components/tasks/tasks-toolbar';

import { PageHeader } from '@/components/ui/page-header';
export const dynamic = 'force-dynamic';

export default async function ManagerTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManager();
  const state = parseTasksSearchParams(await searchParams);
  const [board, options] = await Promise.all([
    listTaskBoard(prisma, session, { scope: state.scope, overdue: state.overdue }),
    getTaskFormOptions(prisma, session),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <PageHeader
          title="Задачи"
          subtitle="Внутренний канбан задач. Перетаскивайте карточки между колонками."
        />
      </div>
      <TasksToolbar state={state} assigneeOptions={null} />
      {state.view === 'list' ? (
        <TaskList board={board} options={options} />
      ) : (
        <TaskBoard board={board} options={options} />
      )}
    </div>
  );
}
