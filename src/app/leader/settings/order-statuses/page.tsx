import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';

export const dynamic = 'force-dynamic';

/** Старый адрес справочника статусов руководителя: редирект при включённом хабе. */
export default async function LeaderOrderStatusesLegacyPage() {
  redirectToSettingsHub('/leader/settings/order-statuses');
}
