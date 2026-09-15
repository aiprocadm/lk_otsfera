import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { prisma } from '@/lib/db/prisma';
import { getTaskDetail } from '@/lib/services/tasks/detail';
import { TaskPageScreen } from '@/components/tasks/task-page-screen';

export const dynamic = 'force-dynamic';

/**
 * Карточка задачи в кабинете менеджера (`У-218`). До этапа 4 задача жила
 * только в модальном окне — открыть её по ссылке было нельзя, а значит нельзя
 * было ни переслать коллеге, ни сослаться из уведомления.
 *
 * Чужая или несуществующая задача — 404: сервис не различает их наружу.
 */
export default async function ManagerTaskPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isFeatureEnabled('internal_tasks')) notFound();
  const session = await requireManager();
  const { id } = await params;

  const result = await getTaskDetail(prisma, session, id);
  if (!result.ok) notFound();

  return <TaskPageScreen task={result.task} cabinet="manager" />;
}
