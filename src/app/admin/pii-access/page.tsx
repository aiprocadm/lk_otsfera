import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminPiiAccessPage from '@/app/admin/settings/security/personal-data/page';

export const dynamic = 'force-dynamic';

/** Старый адрес журнала доступа к ПДн: при включённом хабе — редирект, иначе прежняя страница. */
export default async function AdminPiiAccessLegacyPage(
  props: Parameters<typeof AdminPiiAccessPage>[0]
) {
  redirectToSettingsHub('/admin/pii-access');
  return AdminPiiAccessPage(props);
}
