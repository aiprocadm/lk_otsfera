import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import AdminPaymentsImportPage from '@/app/admin/settings/integrations/1c/payments/page';

export const dynamic = 'force-dynamic';

/** Старый адрес: при включённом хабе «Настройки» — редирект, иначе прежняя страница. */
export default async function AdminPaymentsImportLegacyPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirectToSettingsHub('/admin/payments-import');
  // `У-90`: фильтры и страница очереди переносятся со старого адреса как есть.
  return AdminPaymentsImportPage({ searchParams: Promise.resolve((await searchParams) ?? {}) });
}
