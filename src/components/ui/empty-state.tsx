import React from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Пустое состояние списков и вкладок (`У-74`, этап 9).
 *
 * Требование ТЗ: иконка + «Здесь пока пусто» + одна строка объяснения +
 * главная кнопка. Пустой экран без кнопки — дефект приёмки: человек видит
 * серое пятно и не понимает, сломалось оно или так и надо.
 *
 * Поэтому у компонента появился **заголовок** (по умолчанию «Здесь пока
 * пусто») и явный проп `action` вместо безымянного слота: кнопку теперь видно
 * в вызове, а не приходится искать её среди детей. `children` оставлен для
 * старых вызовов с произвольным содержимым.
 *
 * Кнопки нет — значит её и не должно быть: списки, которые наполняются только
 * извне (обмен с 1С, входящая почта), объясняют это текстом `message`.
 */
export function EmptyState({
  icon,
  title = 'Здесь пока пусто',
  message,
  action,
  className,
  children,
}: {
  icon?: string;
  /** Заголовок состояния. Переопределяют, когда «пусто» — это норма и хорошо. */
  title?: string;
  /** Одна строка: почему пусто и что с этим делать. */
  message: string;
  /** Главное действие — кнопка или ссылка. */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('bg-white border border-gray-200 rounded-xl p-12 text-center', className)}>
      {icon && (
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
          <span className="text-2xl">{icon}</span>
        </div>
      )}
      <p className="text-sm font-medium text-[#111111]">{title}</p>
      <p className="text-gray-500 text-sm mt-1">{message}</p>
      {action && <div className="mt-4">{action}</div>}
      {children}
    </div>
  );
}
