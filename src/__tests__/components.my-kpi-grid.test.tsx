import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className, ...rest }, children),
}));

import { MyKpiGrid } from '@/components/manager/my-kpi-grid';
import type { MyKpiRow } from '@/lib/services/manager/myKpi';

/**
 * Плитки «Мои KPI за месяц» (`У-245`).
 *
 * Проверяется то, что человек читает глазами: своё число, что от него ждут и
 * куда нажать. «0 %» под незаданным планом — отдельный случай: он читается как
 * невыполнение того, чего не поручали.
 */
const row = (over: Partial<MyKpiRow> = {}): MyKpiRow => ({
  metric: 'revenue_paid',
  label: 'Оплачено',
  unit: 'money',
  fact: '120000.00',
  plan: '100000.00',
  percent: 120,
  href: '/manager/finance',
  ...over,
});

describe('MyKpiGrid (У-245)', () => {
  it('показывает своё число, план и процент', () => {
    const html = renderToString(<MyKpiGrid rows={[row()]} month="09.2026" />);
    expect(html).toContain('Оплачено');
    expect(html).toContain('120');
    expect(html).toContain('План');
    expect(html).toContain('120 %');
  });

  it('план не задан — так и написано, а не «0 %»', () => {
    const html = renderToString(
      <MyKpiGrid rows={[row({ plan: null, percent: null })]} month="09.2026" />
    );
    expect(html).toContain('План не задан');
    expect(html).not.toContain('0 %');
  });

  it('плитка ведёт в свой раздел — иначе цифра это тупик', () => {
    const html = renderToString(
      <MyKpiGrid
        rows={[
          row({ metric: 'proposals_sent', href: '/manager/documents?type=commercial_proposal' }),
        ]}
        month="09.2026"
      />
    );
    expect(html).toContain('/manager/documents?type=commercial_proposal');
  });

  it('минуты и штуки показываются своей единицей', () => {
    const minutes = renderToString(
      <MyKpiGrid
        rows={[
          row({
            metric: 'avg_first_response_min',
            unit: 'minutes',
            fact: '42',
            plan: null,
            percent: null,
          }),
        ]}
        month="09.2026"
      />
    );
    expect(minutes).toContain('42 мин');

    const count = renderToString(
      <MyKpiGrid
        rows={[
          row({ metric: 'orders_created', unit: 'count', fact: '7', plan: null, percent: null }),
        ]}
        month="09.2026"
      />
    );
    expect(count).toContain('7');
    expect(count).not.toContain('7 ₽');
  });

  it('показателей нет — объяснение, а не пустое место', () => {
    const html = renderToString(<MyKpiGrid rows={[]} month="09.2026" />);
    expect(html).toContain('Показатели ещё не выбраны');
    expect(html).toContain('Руководитель');
  });

  it('месяц назван прямо — иначе непонятно, за что цифра', () => {
    const html = renderToString(<MyKpiGrid rows={[row()]} month="09.2026" />);
    expect(html).toContain('09.2026');
  });
});
