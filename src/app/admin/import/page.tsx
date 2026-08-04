import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminImportPage from '@/app/admin/settings/integrations/1c/excel/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminImportLegacyPage() {
  redirectToSettingsHub('/admin/import');
  return AdminImportPage();
}
