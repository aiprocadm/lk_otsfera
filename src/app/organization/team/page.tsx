import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Шлюз со старого адреса «Доступ в кабинет» (`У-98`, `У-100`).
 *
 * Кто может зайти в кабинет — это настройка своей организации, поэтому список
 * живёт на вкладке «Настройки» раздела «Моя организация». Прежний адрес
 * остаётся рабочим: по нему приходят из старых писем-приглашений.
 *
 * Права здесь не проверяем: на вкладке они проверяются как раньше — и на
 * показ, и на каждое действие.
 */
export default async function OrganizationTeamGatewayPage() {
  await requireOrganization();
  redirect('/organization/company?tab=settings');
}
