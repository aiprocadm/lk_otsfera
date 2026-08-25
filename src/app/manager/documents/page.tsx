import { requireManager } from '@/lib/auth/requireRole';
import {
  StaffDocuments,
  type StaffDocumentsSearchParams,
} from '@/components/manager/staff-documents';

/**
 * «Документы» менеджера. Экран общий с кабинетом руководителя (`У-110`) —
 * страница только выбирает кабинет и охват: рядовой менеджер видит свой срез.
 */
export default async function ManagerDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<StaffDocumentsSearchParams>;
}) {
  const session = await requireManager();
  return StaffDocuments({ session, cabinet: 'manager', searchParams });
}
