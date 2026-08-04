import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminApplicationStatusesPage from '@/app/admin/settings/catalogs/application-statuses/page';

export const dynamic = 'force-dynamic';

/** Старый адрес справочника статусов: при включённом хабе — редирект, иначе прежняя страница. */
export default async function AdminOrderStatusesLegacyPage() {
  redirectToSettingsHub('/admin/order-statuses');
  return AdminApplicationStatusesPage();
}
