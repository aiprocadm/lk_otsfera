import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminHealthPage from '@/app/admin/settings/system/health/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminHealthLegacyPage() {
  redirectToSettingsHub('/admin/health');
  return AdminHealthPage();
}
