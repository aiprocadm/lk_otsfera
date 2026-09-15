import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getTaskDetail } from '@/lib/services/tasks/detail';
import { TaskPageScreen } from '@/components/tasks/task-page-screen';

export const dynamic = 'force-dynamic';

/**
 * Карточка задачи в кабинете руководителя (`У-218`) — зеркало менеджерской
 * (§0.2, правило зеркала): один и тот же экран, различается только набор
 * задач, которые роль видит. У администратора задач нет — записанное
 * исключение зеркала.
 */
export default async function LeaderTaskPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManagerLeader();
  const { id } = await params;

  const result = await getTaskDetail(prisma, session, id);
  if (!result.ok) notFound();

  return <TaskPageScreen task={result.task} cabinet="leader" />;
}
