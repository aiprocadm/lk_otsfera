import React from 'react';
import Link from 'next/link';
import {
  personalSettingsTabsFor,
  type PersonalSettingsTabKey,
} from '@/lib/navigation/personalSettings';

/**
 * Личные настройки — один экран на все пять кабинетов (`У-114`, решение `Р-23`).
 *
 * Компонент строго презентационный: названия, пояснения и порядок вкладок он
 * берёт из реестра [personalSettings.ts], а **содержимое** каждой вкладки
 * приходит готовым узлом от страницы своей роли. Так данные и права остаются в
 * сервисе роли (§4), а человек в любом кабинете видит один и тот же набор с
 * одними и теми же названиями в одном порядке (§0.2).
 *
 * Вкладка живёт в адресе (`?tab=`), а не в состоянии: ссылкой на «Безопасность»
 * можно поделиться, и кнопка «назад» работает.
 */
export type PersonalSettingsSlots = Partial<Record<PersonalSettingsTabKey, React.ReactNode>>;

export function PersonalSettings({
  basePath,
  activeTab,
  slots,
  team = false,
}: {
  /** Адрес экрана настроек кабинета, например `/manager/settings`. */
  basePath: string;
  activeTab: PersonalSettingsTabKey;
  slots: PersonalSettingsSlots;
  /** Показывать ли «Команду» — она есть только у партнёра-администратора. */
  team?: boolean;
}) {
  const tabs = personalSettingsTabsFor({ team });
  const current = tabs.find((t) => t.key === activeTab) ?? tabs[0];

  return (
    <div className="space-y-4">
      <nav aria-label="Разделы настроек" className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}`}
            data-testid={`personal-tab-${t.key}`}
            data-active={t.key === current?.key}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${
              t.key === current?.key
                ? 'border-[#F97316] text-[#111111] font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* §15 «что здесь делают»: одна строка под переключателем — у каждой
          вкладки своя, из реестра. */}
      {current && <p className="text-sm text-gray-500">{current.description}</p>}

      <div className="space-y-6">{current ? slots[current.key] : null}</div>
    </div>
  );
}
