'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  SETTINGS_GROUPS,
  sectionByPath,
  settingsHref,
  settingsRoot,
  type SettingsCabinet,
  type SettingsSection,
} from '@/lib/navigation/settings';
import { Select } from '@/components/ui';

/**
 * Второй уровень навигации внутри хаба «Настройки» (ТЗ §4.2): слева список
 * групп и подразделов, на узком экране — выпадающий список.
 *
 * Состав приходит уже отфильтрованным по правам (`visibleSettingsSections`):
 * компонент ничего не решает про доступ, он только рисует.
 */
export function SettingsNav({
  cabinet,
  sections,
}: {
  cabinet: SettingsCabinet;
  sections: SettingsSection[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const root = settingsRoot(cabinet);

  const groups = SETTINGS_GROUPS.map((group) => ({
    ...group,
    items: sections.filter((s) => s.group === group.id),
  })).filter((g) => g.items.length > 0);

  // Активный раздел ищем той же логикой «самое длинное совпадение», что и
  // реестр: у `integrations` и `integrations/sync` общий префикс, и наивный
  // startsWith подсвечивал бы оба пункта разом.
  const activeSection = sectionByPath(cabinet, pathname);
  const isActive = (section: SettingsSection) => section.id === activeSection?.id;

  return (
    <>
      {/* Узкий экран: та же карта разделов одним выпадающим списком. */}
      <div className="lg:hidden mb-4">
        <Select
          aria-label="Раздел настроек"
          value={activeSection ? settingsHref(activeSection, cabinet) : root}
          onChange={(e) => router.push(e.target.value)}
        >
          <option value={root}>Все настройки</option>
          {groups.map((group) => (
            <optgroup key={group.id} label={group.title}>
              {group.items.map((section) => (
                <option key={section.id} value={settingsHref(section, cabinet)}>
                  {section.title}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>

      <nav
        aria-label="Разделы настроек"
        className="hidden lg:block w-56 flex-shrink-0"
        data-testid="settings-nav"
      >
        <Link
          href={root}
          className={`block px-2 py-1.5 rounded text-sm mb-3 ${
            pathname === root
              ? 'bg-gray-100 font-medium text-[#111111]'
              : 'text-gray-700 hover:bg-gray-50'
          }`}
          data-active={pathname === root ? 'true' : 'false'}
        >
          Все настройки
        </Link>
        {groups.map((group) => (
          <div key={group.id} className="mb-4">
            <div className="text-xs font-medium uppercase tracking-wider text-gray-500 px-2 mb-1.5">
              {group.title}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((section) => {
                const href = settingsHref(section, cabinet);
                const active = isActive(section);
                return (
                  <li key={section.id}>
                    <Link
                      href={href}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                        active
                          ? 'bg-gray-100 font-medium text-[#111111]'
                          : 'text-gray-700 hover:bg-gray-50'
                      }`}
                      data-testid={`settings-nav-${section.id}`}
                      data-active={active ? 'true' : 'false'}
                    >
                      <span aria-hidden className="text-base">
                        {section.icon}
                      </span>
                      <span>{section.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  );
}
