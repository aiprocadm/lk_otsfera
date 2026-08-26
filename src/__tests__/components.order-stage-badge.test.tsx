import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrderStageBadge } from '@/components/partner/order-stage-badge';
import type { Stage } from '@/lib/orders/humanStage';

describe('OrderStageBadge', () => {
  it('renders neutral tone', () => {
    const stage: Stage = { label: 'Новый', tone: 'neutral' };
    const html = renderToString(React.createElement(OrderStageBadge, { stage }));
    expect(html).toContain('Новый');
    expect(html).toContain('bg-gray-100');
  });

  it('renders success tone', () => {
    const stage: Stage = { label: 'Завершён, оплачен', tone: 'success' };
    const html = renderToString(React.createElement(OrderStageBadge, { stage }));
    expect(html).toContain('bg-green-50');
  });

  it('renders warning tone', () => {
    const stage: Stage = { label: 'На паузе', tone: 'warning' };
    const html = renderToString(React.createElement(OrderStageBadge, { stage }));
    expect(html).toContain('bg-[#FFF7ED]');
  });

  it('renders danger tone', () => {
    const stage: Stage = { label: 'Отменён', tone: 'danger' };
    const html = renderToString(React.createElement(OrderStageBadge, { stage }));
    expect(html).toContain('bg-red-50');
  });
});
