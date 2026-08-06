import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderPaymentsImportPage from '@/app/leader/settings/integrations/1c/payments/page';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес (этап 7 ТЗ импорта, Т-25/Т-27): при включённом хабе «Настройки»
 * руководителя уводит на его вкладку, иначе рендерит её на месте. Гард страницы
 * хаба отбивает обычного менеджера в `/forbidden` в обоих случаях.
 */
export default async function ManagerPaymentsImportLegacyPage() {
  redirectToSettingsHub('/manager/payments-import');
  return LeaderPaymentsImportPage();
}
