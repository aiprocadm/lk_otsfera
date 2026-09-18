import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';

export const dynamic = 'force-dynamic';

/** Старый адрес справочника статусов: при включённом хабе — редирект, иначе прежняя страница. */
export default async function AdminOrderStatusesLegacyPage() {
  redirectToSettingsHub('/admin/order-statuses');
}
