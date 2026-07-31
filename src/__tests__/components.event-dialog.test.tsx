// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const { createEventAction, updateEventAction, deleteEventAction } = vi.hoisted(() => ({
  createEventAction: vi.fn(),
  updateEventAction: vi.fn(),
  deleteEventAction: vi.fn(),
}));
vi.mock('@/server-actions/calendar', () => ({
  createEventAction,
  updateEventAction,
  deleteEventAction,
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { EventDialog } from '@/components/calendar/event-dialog';
import type { CalendarItem, EventFormOptions } from '@/lib/services/calendar/items';

const emptyOptions: EventFormOptions = { users: [], organizations: [], orders: [] };

const fullOptions: EventFormOptions = {
  users: [{ id: 'u1', name: 'Иван Петров' }],
  organizations: [{ id: 'org1', name: 'ООО Ромашка' }],
  orders: [{ id: 'ord1', title: 'Заказ №1' }],
};

const event: CalendarItem = {
  kind: 'event',
  id: 'ev-1',
  title: 'Планёрка отдела',
  date: new Date(2026, 7, 10, 14, 30),
  endsAt: new Date(2026, 7, 10, 15, 30),
  allDay: false,
  location: 'Zoom',
  description: 'Обсудить план на месяц',
  createdById: 'u1',
  createdByName: 'Иван Петров',
  attendeeIds: ['u1'],
  attendeeNames: ['Иван Петров'],
  remindMinutes: 60,
  linkedOrderId: 'ord1',
  linkedOrderTitle: 'Заказ №1',
  linkedOrganizationId: 'org1',
  linkedOrganizationName: 'ООО Ромашка',
  priority: null,
  completedAt: null,
};

function renderDialog(props: React.ComponentProps<typeof EventDialog>) {
  return React.createElement(EventDialog, props);
}

describe('EventDialog', () => {
  const onClose = vi.fn();
  const onSaved = vi.fn();

  beforeEach(() => {
    createEventAction.mockReset();
    updateEventAction.mockReset();
    deleteEventAction.mockReset();
    toastSuccess.mockClear();
    toastError.mockClear();
    onClose.mockClear();
    onSaved.mockClear();

    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  it('create mode: shows "Новое событие", defaultStart = createDate at 10:00, no delete button', async () => {
    render(
      renderDialog({
        target: null,
        createDate: new Date(2026, 7, 15),
        options: fullOptions,
        onClose,
        onSaved,
      })
    );
    expect(await screen.findByText('Новое событие')).toBeTruthy();
    const titleInput = screen.getByLabelText('Название') as HTMLInputElement;
    expect(titleInput.value).toBe('');
    const startsInput = screen.getByLabelText('Начало') as HTMLInputElement;
    expect(startsInput.value).toBe('2026-08-15T10:00');
    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull();
  });

  it('create mode without createDate leaves the start input empty (dateTimeValue null branch)', () => {
    render(
      renderDialog({ target: null, createDate: null, options: fullOptions, onClose, onSaved })
    );
    const startsInput = screen.getByLabelText('Начало') as HTMLInputElement;
    expect(startsInput.value).toBe('');
  });

  it('shows "Нет доступных сотрудников." when options.users is empty', () => {
    render(
      renderDialog({ target: null, createDate: null, options: emptyOptions, onClose, onSaved })
    );
    expect(screen.getByText('Нет доступных сотрудников.')).toBeTruthy();
  });

  it('edit mode: shows "Событие", pre-filled fields, and the delete button', async () => {
    render(
      renderDialog({ target: event, createDate: null, options: fullOptions, onClose, onSaved })
    );
    expect(await screen.findByText('Событие')).toBeTruthy();
    expect((screen.getByLabelText('Название') as HTMLInputElement).value).toBe('Планёрка отдела');
    expect((screen.getByLabelText('Описание') as HTMLTextAreaElement).value).toBe(
      'Обсудить план на месяц'
    );
    expect((screen.getByLabelText('Начало') as HTMLInputElement).value).toBe('2026-08-10T14:30');
    expect((screen.getByLabelText('Окончание (необязательно)') as HTMLInputElement).value).toBe(
      '2026-08-10T15:30'
    );
    expect((screen.getByLabelText('Место / ссылка') as HTMLInputElement).value).toBe('Zoom');
    expect((screen.getByLabelText('Напоминание') as HTMLSelectElement).value).toBe('60');
    expect((screen.getByLabelText('Организация (необязательно)') as HTMLSelectElement).value).toBe(
      'org1'
    );
    expect((screen.getByLabelText('Заявка (необязательно)') as HTMLSelectElement).value).toBe(
      'ord1'
    );
    expect(
      (screen.getByRole('checkbox', { name: 'Иван Петров' }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeTruthy();
  });

  it('create flow: submits form data to createEventAction, toasts success, calls onSaved', async () => {
    createEventAction.mockResolvedValue({ ok: true, id: 'new-id' });
    render(
      renderDialog({
        target: null,
        createDate: new Date(2026, 7, 15),
        options: fullOptions,
        onClose,
        onSaved,
      })
    );
    const dialogTitle = await screen.findByText('Новое событие');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.change(screen.getByLabelText('Название'), {
      target: { value: 'Созвон с партнёром' },
    });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(createEventAction).toHaveBeenCalledTimes(1));
    const fd = createEventAction.mock.calls[0][0] as FormData;
    expect(fd.get('title')).toBe('Созвон с партнёром');
    expect(fd.get('startsAt')).toBe('2026-08-15T10:00');
    expect(fd.get('id')).toBeNull();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Событие создано.'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateEventAction).not.toHaveBeenCalled();
  });

  it('edit flow: submits with the target id set and toasts "updated"', async () => {
    updateEventAction.mockResolvedValue({ ok: true });
    render(
      renderDialog({ target: event, createDate: null, options: fullOptions, onClose, onSaved })
    );
    const dialogTitle = await screen.findByText('Событие');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;

    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(updateEventAction).toHaveBeenCalledTimes(1));
    const fd = updateEventAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('ev-1');
    expect(fd.get('title')).toBe('Планёрка отдела');
    expect(fd.getAll('attendeeIds')).toEqual(['u1']);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Событие обновлено.'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(createEventAction).not.toHaveBeenCalled();
  });

  it('save error: toasts the fallback message and does not call onSaved', async () => {
    createEventAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(
      renderDialog({
        target: null,
        createDate: new Date(2026, 7, 15),
        options: fullOptions,
        onClose,
        onSaved,
      })
    );
    const dialogTitle = await screen.findByText('Новое событие');
    const dialogEl = dialogTitle.closest('dialog') as HTMLElement;
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось сохранить событие.'));
    expect(onSaved).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('delete flow: success calls deleteEventAction with id, toasts, calls onSaved', async () => {
    deleteEventAction.mockResolvedValue({ ok: true });
    render(
      renderDialog({ target: event, createDate: null, options: fullOptions, onClose, onSaved })
    );
    await screen.findByText('Событие');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(deleteEventAction).toHaveBeenCalledTimes(1));
    const fd = deleteEventAction.mock.calls[0][0] as FormData;
    expect(fd.get('id')).toBe('ev-1');
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Событие удалено.'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('delete flow: error path toasts the fallback message and does not call onSaved', async () => {
    deleteEventAction.mockResolvedValue({ ok: false, error: 'weird' });
    render(
      renderDialog({ target: event, createDate: null, options: fullOptions, onClose, onSaved })
    );
    await screen.findByText('Событие');
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось удалить событие.'));
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('cancel button calls onClose without submitting', async () => {
    render(
      renderDialog({ target: null, createDate: null, options: fullOptions, onClose, onSaved })
    );
    await screen.findByText('Новое событие');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createEventAction).not.toHaveBeenCalled();
    expect(updateEventAction).not.toHaveBeenCalled();
  });
});
