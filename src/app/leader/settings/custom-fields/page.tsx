import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderSettingsCustomFieldsPage from '@/app/leader/settings/catalogs/custom-fields/page';

export const dynamic = 'force-dynamic';

/** Старый адрес доп-полей руководителя: редирект при включённом хабе. */
export default async function LeaderCustomFieldsLegacyPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string }>;
}) {
  redirectToSettingsHub('/leader/settings/custom-fields');
  return LeaderSettingsCustomFieldsPage({ searchParams });
}
