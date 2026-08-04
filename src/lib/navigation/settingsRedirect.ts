import { redirect } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { legacyRedirectMap } from '@/lib/navigation/settings';

/**
 * Шлюз старого маршрута (ТЗ §5.1): ни одна сохранённая ссылка не должна отдать
 * 404. При включённом `settings_hub` уводит в хаб по карте редиректов, при
 * выключенном — молча возвращает управление, и страница рендерит прежнее
 * содержимое на прежнем адресе.
 *
 * Редирект временный (307), а не постоянный: 308 браузер кэширует навсегда, и
 * откат флага раскатки оставил бы пользователя с мёртвой навигацией. Перевод на
 * постоянный — шагом снятия флага после приёмки (спека §3.3).
 */
export function redirectToSettingsHub(legacyHref: string): void {
  if (!isFeatureEnabled('settings_hub')) return;
  const target = legacyRedirectMap().get(legacyHref);
  /* v8 ignore next -- пути без цели нет: соответствие карте закреплено тестом реестра */
  if (target) redirect(target);
}
