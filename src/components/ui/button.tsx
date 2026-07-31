'use client';

import React, { forwardRef } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/ui/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-[#F97316] text-white hover:bg-[#EA580C]',
  secondary: 'border border-gray-200 text-[#111111] hover:bg-gray-50',
  ghost: 'text-gray-700 hover:bg-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const SIZE: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:ring-offset-1',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
