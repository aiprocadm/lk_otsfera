import { requireManager } from '@/lib/auth/requireRole';
import { StaffDocumentDetail } from '@/components/documents/staff-document-detail';

export const dynamic = 'force-dynamic';

/** Карточка документа в кабинете менеджера. Экран общий с руководителем (`У-110`). */
export default async function ManagerDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireManager();
  return StaffDocumentDetail({ session, cabinet: 'manager', params });
}
