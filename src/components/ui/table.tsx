import React from 'react';
import { cn } from '@/lib/ui/cn';

/**
 * Композиционные примитивы таблиц (§13: палитра запекается в ui/).
 * Каждая таблица держит свои колонки/ячейки в JSX; примитивы дают только
 * повторяющуюся оболочку. Отклонения — через className (tailwind-merge:
 * caller-классы перекрывают дефолты той же группы).
 */

type TableShellProps = {
  /** 'hidden' (дефолт) — обычные таблицы; 'x-auto' — широкие финансовые. */
  overflow?: 'hidden' | 'x-auto';
  className?: string;
  children?: React.ReactNode;
};

export function TableShell({ overflow = 'hidden', className, children }: TableShellProps) {
  return (
    <div
      className={cn(
        'bg-white border border-gray-200 rounded-xl shadow-sm',
        overflow === 'hidden' ? 'overflow-hidden' : 'overflow-x-auto',
        className
      )}
    >
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function THead({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <thead>
      <tr className={cn('border-b border-gray-100 bg-gray-50 text-left', className)}>{children}</tr>
    </thead>
  );
}

export function Th({ className, children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn('px-4 py-2.5 font-medium text-gray-600', className)} {...rest}>
      {children}
    </th>
  );
}

type TrProps = React.HTMLAttributes<HTMLTableRowElement> & {
  /** false — для «неактивных» строк (team-tables), у которых нет hover-подсветки. */
  hover?: boolean;
};

export function Tr({ hover = true, className, children, ...rest }: TrProps) {
  return (
    <tr
      className={cn(
        'border-b border-gray-50 last:border-b-0',
        hover && 'hover:bg-[#FFF7ED]',
        className
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function Td({ className, children, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn('px-4 py-2.5', className)} {...rest}>
      {children}
    </td>
  );
}
