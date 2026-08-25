import { PERSONAL_SETTINGS_TABS, type PersonalSettingsTabKey } from './personalSettings';

/**
 * Разбор `?tab=` для экрана личных настроек (`У-114`).
 *
 * Один разбор на все кабинеты: неизвестное значение падает на «Профиль», а не
 * на пустой экран. Отдельный модуль, потому что реестр читают и серверные
 * страницы, и клиентский компонент.
 */
export function readPersonalSettingsTab(
  raw: string | undefined,
  opts: { team?: boolean } = {}
): PersonalSettingsTabKey {
  const known = PERSONAL_SETTINGS_TABS.some((t) => t.key === raw);
  if (!known) return 'profile';
  // «Команда» есть не везде: пришедший по прямой ссылке в чужой кабинет
  // попадает на «Профиль», а не на пустую вкладку.
  if (raw === 'team' && !opts.team) return 'profile';
  return raw as PersonalSettingsTabKey;
}
