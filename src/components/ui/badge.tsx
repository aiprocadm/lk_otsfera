import React from 'react';
import { cn } from '@/lib/ui/cn';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  info: 'bg-[#FFF7ED] text-[#9A3412]',
  success: 'bg-green-50 text-green-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700'
};

export function Badge({
  tone = 'neutral',
  className,
  children
}: {
  tone?: Tone;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
