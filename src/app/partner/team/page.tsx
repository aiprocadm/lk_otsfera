import { redirect } from 'next/navigation';

/**
 * Этап 4 (`У-60`): «Команда» переехала на вкладку настроек, а адрес остался
 * тонким шлюзом — закладки и ссылки в старых письмах не должны ломаться.
 * Тот же приём, что `legacyHrefs` в хабе настроек сотрудников.
 */
export default function PartnerTeamPage(): never {
  redirect('/partner/settings?tab=team');
}
