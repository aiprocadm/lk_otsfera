'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  SETTINGS_GROUPS,
  settingsHref,
  type SettingsCabinet,
  type SettingsSection,
} from '@/lib/navigation/settings';
import { Input, EmptyState } from '@/components/ui';

/**
 * Карточки хаба «Настройки» (ТЗ §3): четыре группы, в каждой — плитки с
 * иконкой, названием и одной строкой описания. Поиск в шапке — клиентский
 * фильтр по названию и описанию (ТЗ §4.4), без запросов на сервер.
 *
 * Список приходит отфильтрованным по правам: раздела, на который нет права,
 * в `sections` просто нет (см. `visibleSettingsSections`).
 */
export function SettingsHubCards({
  cabinet,
  sections,
}: {
  cabinet: SettingsCabinet;
  sections: SettingsSection[];
}) {
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? sections.filter(
          (s) =>
            s.title.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle)
        )
      : sections;
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: matched.filter((s) => s.group === group.id),
    })).filter((g) => g.items.length > 0);
  }, [sections, query]);

  return (
    <div className="space-y-6">
      <div className="max-w-md">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по настройкам"
          aria-label="Поиск по настройкам"
          data-testid="settings-search"
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState message="Ничего не найдено" className="p-8" />
      ) : (
        groups.map((group) => (
          <section key={group.id} className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              {group.title}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {group.items.map((section) => (
                <Link
                  key={section.id}
                  href={settingsHref(section, cabinet)}
                  data-testid={`settings-card-${section.id}`}
                  className="flex gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-gray-300 hover:shadow-sm transition-colors"
                >
                  <span aria-hidden className="text-xl leading-none">
                    {section.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-[#111111]">
                      {section.title}
                    </span>
                    <span className="block text-sm text-gray-500">{section.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
