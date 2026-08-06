import { redirectToSettingsHub } from '@/lib/navigation/settingsRedirect';
import LeaderImportPage from '@/app/leader/settings/integrations/1c/excel/page';

export const dynamic = 'force-dynamic';

/**
 * Старый адрес (этап 7 ТЗ импорта, Т-25/Т-27): при включённом хабе «Настройки»
 * руководителя уводит на его вкладку, иначе рендерит её на месте. Гард страницы
 * хаба отбивает обычного менеджера в `/forbidden` в обоих случаях — право
 * импорта осталось только у админа и руководителя.
 */
export default async function ManagerImportLegacyPage() {
  redirectToSettingsHub('/manager/import');
  return LeaderImportPage();
}
