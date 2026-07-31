import React from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Пустое состояние списков/таблиц: белая карточка, опциональный эмодзи-круг,
 * серое сообщение, слот под CTA (children). Паддинг по умолчанию p-12;
 * компактные варианты передают className='p-8' (tailwind-merge перекроет).
 */
export function EmptyState({
  icon,
  message,
  className,
  children,
}: {
  icon?: string;
  message: string;
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
      <p className="text-gray-500 text-sm">{message}</p>
      {children}
    </div>
  );
}
