import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminRolesPage from '@/app/admin/settings/access/roles/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminRolesLegacyPage() {
  redirectToSettingsHub('/admin/roles');
  return AdminRolesPage();
}
