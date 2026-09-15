import { cn } from '@/lib/ui/cn';

/**
 * Классы кнопки в одном месте — и для примитива `ui/Button`, и для ссылок,
 * которые выглядят как кнопка.
 *
 * Зачем отдельный модуль: `ui/button.tsx` помечен `'use client'`, а серверный
 * компонент не может позвать функцию из клиентского модуля — её экспорт
 * превращается в ссылку на клиент. Пока классы жили только там, серверной
 * ссылке-кнопке оставалось скопировать фирменный цвет себе, а копия палитры в
 * новом компоненте запрещена (CLAUDE.md §13): второй экземпляр `#F97316`
 * однажды разъедется с первым, и никто этого не заметит.
 *
 * Модуль чистый: ни React, ни серверных зависимостей — его одинаково честно
 * читают обе стороны границы.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-[#F97316] text-white hover:bg-[#EA580C]',
  secondary: 'border border-gray-200 text-[#111111] hover:bg-gray-50',
  ghost: 'text-gray-700 hover:bg-gray-100',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};

const BUTTON_BASE = [
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
  'focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:ring-offset-1',
  'disabled:opacity-50 disabled:cursor-not-allowed',
];

/** Собрать классы кнопки. Порядок тот же, что был в примитиве. */
export function buttonClass(
  opts: { variant?: ButtonVariant; size?: ButtonSize; className?: string | undefined } = {}
): string {
  const { variant = 'primary', size = 'md', className } = opts;
  return cn(...BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className);
}
