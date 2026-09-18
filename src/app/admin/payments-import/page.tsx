import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес: постоянный редирект в хаб «Настройки».
 *
 * До `У-262` здесь была развилка: при выключенном флаге `settings_hub`
 * страница рендерила прежнее содержимое на прежнем адресе. Флаг снят — хаб
 * принят, откатывать нечего, и вторая ветка стала недостижимой.
 */
export default async function AdminPaymentsImportLegacyPage() {
  redirectToSettingsHub('/admin/payments-import');
}
