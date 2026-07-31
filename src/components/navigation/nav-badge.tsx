'use client';
import React from 'react';
import { useClientResource } from '@/hooks/useClientResource';
import type { StaffBadges } from '@/lib/services/intake/badges';

/**
 * Этап 7 (ФТ-8.4) — живой счётчик пункта меню сотрудника. Поллит агрегирующий
 * GET /api/staff/badges (30 с, visibility-gated — образец NotificationBell) и
 * показывает оранжевый пилл. Ничего не рендерит при 0. Один поллер на пункт
 * терпим (страница держит ≤2 бейджевых пункта); каркас под ФТ-15.2 (этап 11).
 */
export function NavBadge({ badgeKey }: { badgeKey: keyof StaffBadges }) {
  const { data } = useClientResource<number>('/api/staff/badges', {
    intervalMs: 30_000,
    select: (d) => (d as Partial<StaffBadges>)[badgeKey] ?? 0,
  });

  if (!data || data <= 0) return null;

  return (
    <span
      aria-label={badgeKey === 'intake' ? 'Неразобранные входящие' : 'Просроченные задачи'}
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-[#F97316] text-white text-[11px] font-semibold leading-none"
    >
      {data}
    </span>
  );
}
