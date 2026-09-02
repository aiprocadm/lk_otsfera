import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db/prisma';
import { requireManager } from '@/lib/auth/requireRole';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { getClientRequest } from '@/lib/services/clientRequests/list';
import { listClientRequestAttachments } from '@/lib/services/clientRequests/attachments';
import { StaffClientRequestDetail } from '@/components/client-requests/staff-client-request-detail';

export const dynamic = 'force-dynamic';

/**
 * Деталка обращения в кабинете «manager» (`У-116`). Экрана не было: обращение
 * можно было только развернуть строкой в очереди.
 * База — здесь, в слое app: компонент презентационный (`components-no-db`);
 * скоуп режет сервис — чужое обращение неотличимо от несуществующего.
 */
export default async function ManagerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isFeatureEnabled('client_requests')) notFound();
  const session = await requireManager();
  const { id } = await params;

  const res = await getClientRequest(prisma, session, id);
  if (!res.ok) notFound();

  const attachmentsResult = await listClientRequestAttachments(prisma, session, { requestId: id });
  return StaffClientRequestDetail({
    cabinet: 'manager',
    request: res.request,
    attachments: attachmentsResult.ok ? attachmentsResult.rows : [],
    // `У-161`: «Принять и выставить КП» появляется только там, где выпуск
    // документов вообще включён. Флаг читается на сервере — компонент
    // клиентский и сам его прочесть не может.
    canIssueProposal: isFeatureEnabled('document_generation'),
  });
}
