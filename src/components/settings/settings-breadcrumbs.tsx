'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { buildSettingsBreadcrumbs, type SettingsCabinet } from '@/lib/navigation/settings';
import { Breadcrumbs } from '@/components/ui';

/**
 * Крошки подраздела настроек. Путь берётся из `usePathname()` — layout хаба
 * серверный и адреса страницы не знает, а разбирать его в каждой странице
 * означало бы 18 копий одного и того же.
 */
export function SettingsBreadcrumbs({ cabinet }: { cabinet: SettingsCabinet }) {
  const pathname = usePathname();
  return <Breadcrumbs items={buildSettingsBreadcrumbs(cabinet, pathname)} />;
}
