import { requireManagerLeader } from '@/lib/auth/requireRole';
import { StaffDocumentDetail } from '@/components/documents/staff-document-detail';

export const dynamic = 'force-dynamic';

/**
 * Карточка документа в кабинете руководителя (`У-110`). Экран тот же, что у
 * менеджера; отличие — кабинет, из которого человек пришёл и куда вернётся.
 */
export default async function LeaderDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManagerLeader();
  return StaffDocumentDetail({ session, cabinet: 'leader', params });
}
