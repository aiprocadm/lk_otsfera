import React from 'react';
import Link from 'next/link';

/**
 * Вкладки настроек партнёра (`У-60`, этап 4 ТЗ понятности).
 *
 * До этапа настройки были одной прокручиваемой страницей, а «Команда» стояла
 * отдельным пунктом главного меню — рядом с «Заказами», хотя это служебный
 * раздел. Состав вкладок задан ТЗ дословно, порядок не менять без правки ТЗ.
 */
export type PartnerSettingsTab = 'profile' | 'team' | 'notifications' | 'security';

const TABS: { key: PartnerSettingsTab; label: string; adminOnly?: boolean }[] = [
  { key: 'profile', label: 'Профиль и реквизиты' },
  { key: 'team', label: 'Команда', adminOnly: true },
  { key: 'notifications', label: 'Уведомления' },
  { key: 'security', label: 'Безопасность' },
];

export function PartnerSettingsTabs({
  active,
  isAdmin,
}: {
  active: PartnerSettingsTab;
  isAdmin: boolean;
}) {
  // Скрытая вкладка — это внешний вид, а не защита: содержимое «Команды»
  // дополнительно закрыто серверным гардом на самой странице (§4).
  const tabs = TABS.filter((t) => !t.adminOnly || isAdmin);

  return (
    <nav className="border-b border-gray-200 flex gap-4 overflow-x-auto">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <Link
            key={t.key}
            href={`/partner/settings?tab=${t.key}`}
            data-testid={`partner-settings-tab-${t.key}`}
            data-active={isActive ? 'true' : 'false'}
            className={`pb-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              isActive
                ? 'text-[#F97316] border-[#F97316]'
                : 'text-gray-600 border-transparent hover:text-[#111111]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
