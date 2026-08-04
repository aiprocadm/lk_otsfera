import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminAuditPage from '@/app/admin/settings/security/audit/page';

export const dynamic = 'force-dynamic';

/** Старый адрес журнала аудита: при включённом хабе — редирект, иначе прежняя страница. */
export default async function AdminAuditLegacyPage(props: Parameters<typeof AdminAuditPage>[0]) {
  redirectToSettingsHub('/admin/audit');
  return AdminAuditPage(props);
}
