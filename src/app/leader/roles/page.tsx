import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderRolesPage from '@/app/leader/settings/access/roles/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function LeaderRolesLegacyPage() {
  redirectToSettingsHub('/leader/roles');
  return LeaderRolesPage();
}
