import React, { type ReactNode } from 'react';
import { OneCTabs } from '@/components/settings/one-c-tabs';

/**
 * Подраздел «Обмен с 1С» в хабе руководителя (этап 7 ТЗ импорта, Т-27) —
 * зеркало админского: две загрузки живут своими страницами, общим остаётся
 * только переключатель вкладок. `h1` держит сама вкладка.
 */
export default function LeaderOneCLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <OneCTabs cabinet="leader" />
      {children}
    </div>
  );
}
