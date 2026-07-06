// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { transitionOrderStatusAction } = vi.hoisted(() => ({ transitionOrderStatusAction: vi.fn() }));
vi.mock('@/server-actions/manager/transitionOrderStatus', () => ({ transitionOrderStatusAction }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { ManagerStatusChangeForm } from '@/components/manager/manager-status-change-form';

describe('ManagerStatusChangeForm (SSR structure)', () => {
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

describe('ManagerStatusChangeForm (interactive, jsdom)', () => {
  let showModal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    transitionOrderStatusAction.mockReset();
    transitionOrderStatusAction.mockResolvedValue({ ok: true, changed: true });
    showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModal;
    HTMLDialogElement.prototype.close = close;
  });

  it('"cancelled" locked-статус: кнопка "Изменить" неактивна (noop === true при in_progress fallback не применяется)', () => {
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));
    const triggerButton = screen.getByRole('button', { name: 'Изменить' });
    // Текущий статус совпадает с выбранным по умолчанию -> noop -> disabled
    expect((triggerButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('смена select на другой статус активирует кнопку "Изменить", клик открывает Dialog', async () => {
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'completed' } });

    const triggerButton = screen.getByRole('button', { name: 'Изменить' });
    expect((triggerButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(triggerButton);

    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Новый статус: «Завершён»/)).toBeTruthy();
  });

  it('"Отмена" в диалоге закрывает его без сабмита', async () => {
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(transitionOrderStatusAction).not.toHaveBeenCalled();
  });

  it('Escape (Dialog cancel-событие) вызывает onClose и закрывает диалог без сабмита', async () => {
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    const dialogEl = document.querySelector('dialog') as HTMLDialogElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(transitionOrderStatusAction).not.toHaveBeenCalled();
  });

  it('"Подтвердить" вызывает requestSubmit -> action со свежим статусом из формы', async () => {
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(transitionOrderStatusAction).toHaveBeenCalledWith({ orderId: 'o1', newStatus: 'completed' }));
  });

  it('ошибка action: рендерит алерт с замапленным текстом (invalid_status)', async () => {
    transitionOrderStatusAction.mockResolvedValue({ ok: false, error: 'invalid_status' });
    render(React.createElement(ManagerStatusChangeForm, { orderId: 'o1', currentStatus: 'in_progress' as never }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByText('Недопустимый статус.')).toBeTruthy();
  });
});
