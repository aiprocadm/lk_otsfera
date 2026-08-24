import { redirect } from 'next/navigation';
import { requireOrganization } from '@/lib/auth/requireRole';

export const dynamic = 'force-dynamic';

/**
 * Шлюз со старого адреса справочника сотрудников (`У-100`).
 *
 * Сотрудники — часть своей организации, поэтому живут на вкладке «Сотрудники»
 * раздела «Моя организация». Прежний адрес не удаляем: по нему остались
 * закладки и ссылки в письмах.
 */
export default async function OrganizationStudentsGatewayPage() {
  await requireOrganization();
  redirect('/organization/company?tab=employees');
}
