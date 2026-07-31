// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { OrderReadiness } from '@/lib/orders/readiness';

/**
 * Этап 12 (ФТ-5.1/5.2) — блок «Готовность к передаче»: показывает ЧЕГО не
 * хватает и по какому слушателю; кнопка передачи активна только при полной
 * готовности; после передачи кнопки нет (передача однократна, §6-3).
 */

const { success } = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success } }));

const { deliverOrderResultAction, approveDeliverablesAction } = vi.hoisted(() => ({
  deliverOrderResultAction: vi.fn(),
  approveDeliverablesAction: vi.fn(),
}));
vi.mock('@/server-actions/manager/orderDelivery', () => ({
  deliverOrderResultAction,
  approveDeliverablesAction,
}));

import { OrderReadinessPanel } from '@/components/manager/order-readiness-panel';

const READY: OrderReadiness = { ready: true, gaps: [], items: [] };
const NOT_READY: OrderReadiness = {
  ready: false,
  gaps: ['items_not_ready'],
  items: [{ itemId: 'i1', studentName: 'Иванов Иван', gaps: ['certificate_scan_missing'] }],
};

const props = {
  orderId: 'o1',
  serviceType: 'training' as const,
  readiness: READY,
  deliveredAt: null,
  deliverablesApproved: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  deliverOrderResultAction.mockResolvedValue({
    ok: true,
    deliveredAt: '2026-07-27T10:00:00.000Z',
    alreadyDelivered: false,
  });
  approveDeliverablesAction.mockResolvedValue({ ok: true, approvedAt: '2026-07-27T09:00:00.000Z' });
});

describe('OrderReadinessPanel', () => {
  it('готовый заказ: бейдж «Готов», кнопка активна', () => {
    render(React.createElement(OrderReadinessPanel, props));
    expect(screen.getByText('Готов')).toBeTruthy();
    const btn = screen.getByText('Передать результат клиенту') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('не готов: кнопка заблокирована, видно замечание и фамилию слушателя', () => {
    render(React.createElement(OrderReadinessPanel, { ...props, readiness: NOT_READY }));
    expect(screen.getByText('Не готов')).toBeTruthy();
    expect((screen.getByText('Передать результат клиенту') as HTMLButtonElement).disabled).toBe(
      true
    );
    expect(screen.getByText('Не по всем слушателям готовы удостоверения')).toBeTruthy();
    expect(screen.getByText('Иванов Иван')).toBeTruthy();
    expect(screen.getByText(/не загружен скан удостоверения/)).toBeTruthy();
  });

  it('передача: зовёт экшен и показывает toast', async () => {
    render(React.createElement(OrderReadinessPanel, props));
    fireEvent.click(screen.getByText('Передать результат клиенту'));
    await waitFor(() => expect(deliverOrderResultAction).toHaveBeenCalledWith({ orderId: 'o1' }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Результат передан клиенту'));
  });

  it('после передачи кнопки нет — только дата и пояснение', () => {
    render(
      React.createElement(OrderReadinessPanel, {
        ...props,
        deliveredAt: '2026-07-27T10:00:00.000Z',
      })
    );
    expect(screen.queryByText('Передать результат клиенту')).toBeNull();
    expect(screen.getByText(/Передан/)).toBeTruthy();
    expect(screen.getByText(/Повторная передача не требуется/)).toBeTruthy();
  });

  it('повторный ответ сервиса «уже передан» показывается своим текстом', async () => {
    deliverOrderResultAction.mockResolvedValue({
      ok: true,
      deliveredAt: '2026-07-01T10:00:00.000Z',
      alreadyDelivered: true,
    });
    render(React.createElement(OrderReadinessPanel, props));
    fireEvent.click(screen.getByText('Передать результат клиенту'));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Результат уже был передан'));
  });

  it('ошибка «не готов» от сервиса показывается по-русски', async () => {
    deliverOrderResultAction.mockResolvedValue({
      ok: false,
      error: 'not_ready',
      readiness: NOT_READY,
    });
    render(React.createElement(OrderReadinessPanel, props));
    fireEvent.click(screen.getByText('Передать результат клиенту'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('ещё не готов к передаче')
    );
  });

  it('прочая ошибка — общий текст', async () => {
    deliverOrderResultAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(React.createElement(OrderReadinessPanel, props));
    fireEvent.click(screen.getByText('Передать результат клиенту'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Не удалось передать результат')
    );
  });

  it('разработка документов: видно замечание и кнопку отметки', () => {
    render(
      React.createElement(OrderReadinessPanel, {
        ...props,
        serviceType: 'document_development',
        readiness: { ready: false, gaps: ['deliverables_not_approved'], items: [] },
      })
    );
    expect(screen.getByText('Менеджер не отметил работу согласованной')).toBeTruthy();
    expect(screen.getByText('Отметить работу согласованной')).toBeTruthy();
  });

  it('отметка «согласовано» не прошла → видна ошибка, отметка не ставится', async () => {
    // Экшен может отказать (заказ перевели, права изменились). Панель обязана
    // сказать об этом вслух, а не молча притвориться, что отметка стоит.
    approveDeliverablesAction.mockResolvedValue({ ok: false, error: 'forbidden' });
    render(
      React.createElement(OrderReadinessPanel, {
        ...props,
        serviceType: 'document_development',
        readiness: { ready: false, gaps: ['deliverables_not_approved'], items: [] },
      })
    );
    fireEvent.click(screen.getByText('Отметить работу согласованной'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Не удалось поставить отметку')
    );
    expect(screen.getByText('Отметить работу согласованной')).toBeTruthy();
  });

  it('согласование уже стоит — кнопки отметки нет', () => {
    render(
      React.createElement(OrderReadinessPanel, {
        ...props,
        serviceType: 'document_development',
        deliverablesApproved: true,
        readiness: { ready: false, gaps: ['deliverables_missing'], items: [] },
      })
    );
    expect(screen.queryByText('Отметить работу согласованной')).toBeNull();
  });

  it('отметка согласования: зовёт экшен и прячет кнопку', async () => {
    render(
      React.createElement(OrderReadinessPanel, {
        ...props,
        serviceType: 'document_development',
        readiness: { ready: false, gaps: ['deliverables_not_approved'], items: [] },
      })
    );
    fireEvent.click(screen.getByText('Отметить работу согласованной'));
    await waitFor(() => expect(approveDeliverablesAction).toHaveBeenCalledWith({ orderId: 'o1' }));
    await waitFor(() => expect(success).toHaveBeenCalledWith('Работа отмечена согласованной'));
  });

  it('обучение: кнопки согласования нет', () => {
    render(React.createElement(OrderReadinessPanel, { ...props, readiness: NOT_READY }));
    expect(screen.queryByText('Отметить работу согласованной')).toBeNull();
  });
});
