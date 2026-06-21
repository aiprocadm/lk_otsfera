import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('@/server-actions/manager/transitionOrderStatus', () => ({
  transitionOrderStatusAction: vi.fn()
}));
vi.mock('@/lib/ui/useFormAction', () => ({
  useFormAction: () => ({ formAction: () => {}, pending: false, errorText: null })
}));

import { ManagerStatusChangeForm } from '@/components/manager/manager-status-change-form';

describe('ManagerStatusChangeForm', () => {
  it('рендерит триггер «Изменить»', () => {
    const html = renderToString(
      React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'pending' as never })
    );
    expect(html).toContain('Изменить');
  });

  it('locked-статус показывает read-only нотис', () => {
    const html = renderToString(
      React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'cancelled' as never })
    );
    expect(html).toContain('отдельным процессом');
  });

  it('не рендерит select для locked-статуса', () => {
    const html = renderToString(
      React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'on_hold' as never })
    );
    expect(html).not.toContain('<select');
  });

  it('рендерит select с вариантами статусов для editable-статуса', () => {
    const html = renderToString(
      React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never })
    );
    expect(html).toContain('В работе');
    expect(html).toContain('Завершён');
  });
});
