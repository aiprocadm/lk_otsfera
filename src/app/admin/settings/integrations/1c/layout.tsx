import React, { type ReactNode } from 'react';
import { OneCTabs } from '@/components/settings/one-c-tabs';

/**
 * Подраздел «Обмен с 1С» (ТЗ §10). Две загрузки живут своими страницами —
 * логика у них разная, объединять их запрещено ТЗ; общим остаётся только
 * переключатель вкладок. Свой `h1` каждая вкладка держит сама: второй
 * заголовок первого уровня в layout ломал бы структуру страницы.
 */
export default function AdminOneCLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <OneCTabs />
      {children}
    </div>
  );
}
