import React, { type ReactNode } from 'react';
import { BitrixTabs } from '@/components/settings/bitrix-tabs';

/**
 * Раздел «Миграция из Битрикс24» (этап 2 ТЗ 12.09.2026, `У-188`): вкладки
 * «Подключение» и «Пакеты». Гард раздела (`requireSettingsSection`) стоит на
 * каждой странице, а не здесь: право проверяется на каждый запрос (§2b).
 */
export default function AdminBitrixLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <BitrixTabs />
      {children}
    </div>
  );
}
