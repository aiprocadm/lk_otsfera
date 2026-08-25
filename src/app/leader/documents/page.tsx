import { requireManagerLeader } from '@/lib/auth/requireRole';
import {
  StaffDocuments,
  type StaffDocumentsSearchParams,
} from '@/components/manager/staff-documents';

export const dynamic = 'force-dynamic';

/**
 * «Документы» руководителя (`У-110`). Раздела не было вовсе: за документами
 * руководитель уходил в кабинет менеджера и видел там **свой** срез, а не срез
 * компании. Экран тот же, охват — вся компания (`teamModeOverride`).
 */
export default async function LeaderDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<StaffDocumentsSearchParams>;
}) {
  const session = await requireManagerLeader();
  return StaffDocuments({ session, cabinet: 'leader', searchParams, teamModeOverride: true });
}
