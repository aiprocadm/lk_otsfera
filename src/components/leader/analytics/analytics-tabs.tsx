import React from 'react';
import Link from 'next/link';

/**
 * Вкладки «Аналитики» (`У-243`, этап 7).
 *
 * Названия живут в одном словаре: у руководителя и у администратора набор и
 * порядок вкладок обязаны совпадать (правило зеркала §0.2), а совпадение,
 * набранное в двух местах руками, разъезжается на первой же правке.
 */
const ANALYTICS_TABS = [
  { key: 'plan', label: 'План и факт' },
  { key: 'funnel', label: 'Воронка' },
  { key: 'communications', label: 'Коммуникации' },
  { key: 'receivables', label: 'Дебиторка' },
  { key: 'partners', label: 'Партнёры' },
] as const;

export type AnalyticsTabKey = (typeof ANALYTICS_TABS)[number]['key'];

export function isAnalyticsTab(value: string | undefined): value is AnalyticsTabKey {
  return ANALYTICS_TABS.some((t) => t.key === value);
}

export function AnalyticsTabs({
  basePath,
  active,
  query,
}: {
  /** `/leader/analytics` или `/admin/finance`. */
  basePath: string;
  active: AnalyticsTabKey;
  /** Хвост адреса: месяц, выбранная компания. */
  query?: Record<string, string> | undefined;
}) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-gray-200" data-testid="analytics-tabs">
      {ANALYTICS_TABS.map((tab) => {
        const params = new URLSearchParams({ ...(query ?? {}), tab: tab.key });
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?${params.toString()}`}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`analytics-tab-${tab.key}`}
            className={
              isActive
                ? 'border-b-2 border-[#F97316] px-3 py-2 text-sm font-medium text-[#111111]'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-gray-500 hover:text-[#111111]'
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
