import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
// `У-46` (этап 7): страница «Синхронизации» переехала во вкладку «Автообмен»
// экрана «Обмен с 1С». Прежний адрес остаётся шлюзом: при включённом хабе —
// редирект, при выключенном — та же страница на прежнем месте.
import AdminSyncPage from '@/app/admin/settings/integrations/1c/auto/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminSyncLegacyPage() {
  redirectToSettingsHub('/admin/sync');
  return AdminSyncPage();
}
