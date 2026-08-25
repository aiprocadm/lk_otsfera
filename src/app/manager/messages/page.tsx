import { requireManager } from '@/lib/auth/requireRole';
import { StaffMessages } from '@/components/manager/staff-messages';

/** «Сообщения» менеджера. Экран общий с кабинетом руководителя (`У-110`). */
export default async function ManagerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const session = await requireManager();
  return StaffMessages({ session, searchParams });
}
