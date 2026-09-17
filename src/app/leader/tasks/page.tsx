import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listTaskBoard, getTaskFormOptions } from '@/lib/services/tasks/board';
import { parseTasksSearchParams } from '@/lib/tasks/filters';
import { TaskBoard } from '@/components/tasks/task-board';
import { TaskList } from '@/components/tasks/task-list';
import { TasksToolbar } from '@/components/tasks/tasks-toolbar';
import { ColumnConfig } from '@/components/tasks/column-config';

import { PageHeader } from '@/components/ui/page-header';
import { MissingObjectNotice } from '@/components/ui/missing-object-notice';
import { isMissingObjectRequested } from '@/lib/navigation/missingObject';
import { ListCapNotice } from '@/components/ui';
export const dynamic = 'force-dynamic';

export default async function LeaderTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManagerLeader();
  const sp = await searchParams;
  const state = parseTasksSearchParams(sp);
  const [board, options] = await Promise.all([
    listTaskBoard(prisma, session, {
      scope: state.scope,
      overdue: state.overdue,
      assigneeId: state.assigneeId,
    }),
    getTaskFormOptions(prisma, session),
  ]);
  const isDefault = board.columns.length > 0 && board.columns[0]!.id.startsWith('default:');

  return (
    <div className="space-y-8">
      <div>
        <PageHeader
          title="Задачи"
          subtitle="Внутренний канбан задач. Перетаскивайте карточки между колонками; настройте колонки под процесс команды."
        />
      </div>
      {/* `У-232`: пришли по ссылке на удалённую или чужую задачу. */}
      {isMissingObjectRequested(sp) && <MissingObjectNotice what="Задача" feminine />}
      <TasksToolbar state={state} assigneeOptions={options.users} />
      {state.view === 'list' ? (
        <TaskList board={board} options={options} hrefBase="/leader/tasks" />
      ) : (
        <TaskBoard board={board} options={options} hrefBase="/leader/tasks" />
      )}
      <ListCapNotice
        shown={board.shown}
        total={board.total}
        hint="Открытые задачи идут первыми и не теряются; за пределом — самые старые выполненные, сузьте охват фильтрами."
      />
      <ColumnConfig columns={board.columns} isDefault={isDefault} />
    </div>
  );
}
