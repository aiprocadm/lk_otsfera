import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminIntegrationsPage from '@/app/admin/settings/integrations/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminIntegrationsLegacyPage() {
  redirectToSettingsHub('/admin/integrations');
  return AdminIntegrationsPage();
}
