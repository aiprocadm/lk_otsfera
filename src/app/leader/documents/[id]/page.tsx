import React from 'react';
import { notFound } from 'next/navigation';
import { requireManagerLeader } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { listLinkedTasks } from '@/lib/services/tasks/board';
import { getDocumentHistory } from '@/lib/services/documents/history';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffDocumentDetail } from '@/components/documents/staff-document-detail';

export const dynamic = 'force-dynamic';

/**
 * Карточка документа в кабинете руководителя (`У-110`). Экран тот же, что у
 * менеджера; отличие — кабинет, из которого человек пришёл и куда вернётся.
 * База — здесь, в слое app: компонент презентационный (`components-no-db`),
 * скоуп выборки держит сервис по сессии.
 */
export default async function LeaderDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManagerLeader();
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);
  // `У-220`: блок «Задачи» только вместе с самим разделом задач.
  const tasksEnabled = isFeatureEnabled('internal_tasks');
  const tasks = tasksEnabled ? await listLinkedTasks(prisma, session, { documentId: id }) : null;
  // `У-251`, `У-254`: история версий и «Кто скачивал» — как у менеджера.
  const history = await getDocumentHistory(prisma, session, id);

  return (
    <StaffDocumentDetail
      cabinet="leader"
      document={res.document}
      customFields={customFields}
      tasks={tasks}
      currentUserId={session.sub}
      history={history.ok ? history.history : null}
    />
  );
}
