import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminPaymentsImportPage from '@/app/admin/settings/integrations/1c/payments/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminPaymentsImportLegacyPage() {
  redirectToSettingsHub('/admin/payments-import');
  return AdminPaymentsImportPage();
}
