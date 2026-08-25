import { requireManagerLeader } from '@/lib/auth/requireRole';
import { StaffMessages } from '@/components/manager/staff-messages';

export const dynamic = 'force-dynamic';

/**
 * «Сообщения» руководителя (`У-110`). Пункт меню вёл в кабинет менеджера —
 * человек нажимал свой раздел и оказывался в чужом кабинете. Теперь раздел
 * свой, а переписка — по всей компании.
 */
export default async function LeaderMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await requireManagerLeader();
  return StaffMessages({ session, teamModeOverride: true, searchParams });
}
