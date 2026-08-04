import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderApplicationStatusesPage from '@/app/leader/settings/catalogs/application-statuses/page';

export const dynamic = 'force-dynamic';

/** Старый адрес справочника статусов руководителя: редирект при включённом хабе. */
export default async function LeaderOrderStatusesLegacyPage() {
  redirectToSettingsHub('/leader/settings/order-statuses');
  return LeaderApplicationStatusesPage();
}
