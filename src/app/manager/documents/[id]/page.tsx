import React from 'react';
import { notFound } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';
import { prisma } from '@/lib/db/prisma';
import { getDocumentDetail } from '@/lib/services/documents/detail';
import { getFieldsForEntity } from '@/lib/services/customFields';
import { listLinkedTasks } from '@/lib/services/tasks/board';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { StaffDocumentDetail } from '@/components/documents/staff-document-detail';

export const dynamic = 'force-dynamic';

/**
 * Карточка документа в кабинете менеджера. Экран общий с руководителем
 * (`У-110`). База — здесь, в слое app: компонент презентационный
 * (`components-no-db`), скоуп выборки держит сервис по сессии.
 */
export default async function ManagerDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  const { id } = await params;

  const res = await getDocumentDetail(prisma, session, id);
  if (!res.ok) notFound();

  const customFields = await getFieldsForEntity(prisma, session, 'document', id);
  // `У-220`: блок «Задачи» только вместе с самим разделом задач.
  const tasksEnabled = isFeatureEnabled('internal_tasks');
  const tasks = tasksEnabled ? await listLinkedTasks(prisma, session, { documentId: id }) : null;

  return (
    <StaffDocumentDetail
      cabinet="manager"
      document={res.document}
      customFields={customFields}
      tasks={tasks}
      currentUserId={session.sub}
    />
  );
}
