'use client';

import React, { forwardRef } from 'react';
import { cn } from '@/lib/ui/cn';

const CONTROL =
  'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent disabled:opacity-50';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref
) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(CONTROL, invalid ? 'border-red-400' : 'border-gray-300', className)}
      {...rest}
    >
      {children}
    </select>
  );
});
