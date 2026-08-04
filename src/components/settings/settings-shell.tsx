import React, { type ReactNode } from 'react';
import type { SettingsCabinet, SettingsSection } from '@/lib/navigation/settings';
import { SettingsNav } from './settings-nav';
import { SettingsBreadcrumbs } from './settings-breadcrumbs';

/**
 * Оболочка хаба «Настройки»: крошки сверху, карта разделов слева, контент
 * справа (ТЗ §4.2–4.3). На узком экране навигация схлопывается в выпадающий
 * список — за это отвечает сам `SettingsNav`.
 */
export function SettingsShell({
  cabinet,
  sections,
  children,
}: {
  cabinet: SettingsCabinet;
  sections: SettingsSection[];
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <SettingsBreadcrumbs cabinet={cabinet} />
      <div className="flex flex-col lg:flex-row lg:gap-8">
        <SettingsNav cabinet={cabinet} sections={sections} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
