import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminSettingsCustomFieldsPage from '@/app/admin/settings/catalogs/custom-fields/page';

export const dynamic = 'force-dynamic';

/** Старый адрес доп-полей: при включённом хабе — редирект, иначе прежняя страница. */
export default async function AdminCustomFieldsLegacyPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  redirectToSettingsHub('/admin/custom-fields');
  return AdminSettingsCustomFieldsPage({ searchParams });
}
