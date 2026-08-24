import { redirect } from 'next/navigation';
import { requireManager } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес списка сотрудников менеджера (`У-103`).
 *
 * Сотрудники ведутся в карточке организации — вкладка «Сотрудники» (`У-97`).
 * Отдельный сквозной список снят: он показывал людей вперемешку из разных
 * организаций, и было непонятно, к кому человек относится. Адрес остаётся
 * рабочим шлюзом, чтобы закладки и ссылки из писем не ломались; поиск по всем
 * организациям живёт в командной палитре и `/manager/search`.
 */
export default async function ManagerStudentsLegacyPage() {
  await requireManager();
  redirect('/manager/organizations');
}
