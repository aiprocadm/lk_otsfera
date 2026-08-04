import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminSyncPage from '@/app/admin/settings/integrations/sync/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminSyncLegacyPage() {
  redirectToSettingsHub('/admin/sync');
  return AdminSyncPage();
}
