import React, { type ReactNode } from 'react';
import { OneCTabs } from '@/components/settings/one-c-tabs';

/**
 * Раздел «Обмен с 1С» в кабинете менеджера (`У-113`).
 *
 * Раньше обмен был **двумя пунктами меню** — «Загрузка Excel из 1С» и
 * «Выписка по счёту 51», — и человеку приходилось помнить, что это одна задача,
 * разложенная по двум местам. Теперь это один раздел с вкладками, теми же, что
 * в хабе настроек у администратора и руководителя.
 *
 * «Автообмена» здесь нет намеренно: расписаниями управляют администратор и
 * руководитель, а не тот, кто вручную грузит файлы.
 *
 * Свой `h1` каждая вкладка держит сама — второй заголовок первого уровня в
 * layout ломал бы структуру страницы.
 */
export default function ManagerExchangeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <OneCTabs basePath="/manager/exchange" only={['excel', 'payments', 'history']} />
      {children}
    </div>
  );
}
