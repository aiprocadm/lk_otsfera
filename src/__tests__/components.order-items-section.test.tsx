import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// OrderItemsSection calls useRouter() unconditionally — stub it so the client
// component can render under react-dom/server (no Next app-router provider in
// the unit harness).
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { OrderItemsSection } from '@/components/training/order-items-section';

describe('OrderItemsSection', () => {
  it('рендерит слушателей с направлением и статусом', () => {
    const html = renderToString(
      <OrderItemsSection
        orderId="o1"
        canEdit={false}
        items={[{ id: 'it1', trainingStatus: 'in_progress', note: null,
          student: { id: 's1', name: 'Иванов', email: 'i@o.ru' },
          direction: { id: 'd1', name: 'Охрана труда' },
          certificate: null } as any]}
        directions={[]}
        students={[]}
      />
    );
    expect(html).toContain('Иванов');
    expect(html).toContain('Охрана труда');
    expect(html).toContain('Обучается');
  });

  it('без прав не показывает кнопку добавления', () => {
    const html = renderToString(
      <OrderItemsSection orderId="o1" canEdit={false} items={[]} directions={[]} students={[]} />
    );
    expect(html).not.toContain('Добавить слушателя');
  });
});
