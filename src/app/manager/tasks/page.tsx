import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { listTaskBoard, getTaskFormOptions } from '@/lib/services/tasks/board';
import { TaskBoard } from '@/components/tasks/task-board';

export const dynamic = 'force-dynamic';

export default async function ManagerTasksPage() {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManager();
  const [board, options] = await Promise.all([listTaskBoard(prisma, session), getTaskFormOptions(prisma, session)]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#111111]">Задачи</h1>
        <p className="text-sm text-gray-500 mt-1">Внутренний канбан задач. Перетаскивайте карточки между колонками.</p>
      </div>
      <TaskBoard board={board} options={options} />
    </div>
  );
}