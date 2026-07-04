import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listTaskBoard, getTaskFormOptions } from '@/lib/services/tasks/board';
import { TaskBoard } from '@/components/tasks/task-board';
import { ColumnConfig } from '@/components/tasks/column-config';

export const dynamic = 'force-dynamic';

export default async function LeaderTasksPage() {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManagerLeader();
  const [board, options] = await Promise.all([listTaskBoard(prisma, session), getTaskFormOptions(prisma, session)]);
  const isDefault = board.columns.length > 0 && board.columns[0]!.id.startsWith('default:');

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Задачи</h1>
        <p className="text-sm text-gray-500 mt-1">
          Внутренний канбан задач. Перетаскивайте карточки между колонками; настройте колонки под процесс команды.
        </p>
      </div>
      <TaskBoard board={board} options={options} />
      <ColumnConfig columns={board.columns} isDefault={isDefault} />
    </div>
  );
}
