// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { OrderItemRow } from '@/lib/services/training';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { OrderItemsSection, TRAINING_STATUS_RU } from '@/components/training/order-items-section';

const DIRECTIONS = [{ id: 'd1', name: 'Охрана труда' }];
const STUDENTS = [{ id: 's1', name: 'Иван Петров', email: 'ivan@example.com' }];

function item(overrides: Partial<OrderItemRow> = {}): OrderItemRow {
  return {
    id: 'i1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    orderId: 'order-1',
    studentId: 's1',
    student: { id: 's1', name: 'Иван Петров', email: 'ivan@example.com' },
    directionId: 'd1',
    direction: { id: 'd1', name: 'Охрана труда' },
    trainingStatus: 'pending',
    note: null,
    certificate: null,
    ...overrides,
  } as OrderItemRow;
}

describe('OrderItemsSection', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();

    // jsdom has no native <dialog> behaviour — see the Dialog exemplar.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "Слушатели не добавлены." and no count badge when items is empty', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(screen.getByText('Слушатели не добавлены.')).toBeTruthy();
    expect(screen.queryByText('(0)')).toBeNull();
  });

  it('shows the item count badge when items is non-empty', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(screen.getByText('(1)')).toBeTruthy();
  });

  it('canEdit=false hides "Добавить слушателя" and the Действия column, shows a read-only status Badge', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: false,
        items: [item({ trainingStatus: 'in_progress' })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(screen.queryByRole('button', { name: 'Добавить слушателя' })).toBeNull();
    expect(screen.queryByText('Действия')).toBeNull();
    expect(screen.getByText('Обучается')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('unmapped trainingStatus falls back to the raw code (?? item.trainingStatus branch)', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: false,
        items: [item({ trainingStatus: 'weird_status' as OrderItemRow['trainingStatus'] })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(screen.getByText('weird_status')).toBeTruthy();
  });

  it('canEdit=true renders a status Select with all TRAINING_STATUS_RU options', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('pending');
    for (const label of Object.values(TRAINING_STATUS_RU)) {
      expect(within(select).getByText(label)).toBeTruthy();
    }
  });

  it('shows the certificate number when present, em dash otherwise, and no "issue" button once issued', () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [
          item({
            id: 'i1',
            certificate: {
              id: 'c1',
              number: 'УТ-01',
              validUntil: null,
            } as OrderItemRow['certificate'],
          }),
          item({ id: 'i2', certificate: null }),
        ],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(screen.getByText('УТ-01')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Выдать удостоверение' }).length).toBe(1);
  });

  it('status change: PATCH success shows a toast and router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item({ id: 'i7' })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in_progress' } });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/manager/order-items/i7',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ trainingStatus: 'in_progress' }),
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Статус обновлён'));
    expect(refresh).toHaveBeenCalled();
  });

  it('status change: PATCH failure (with error body) shows the mapped toast error', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'validation' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cancelled' } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('status change: PATCH failure with unparsable json still shows a toast error (catch->{} + ?? unknown)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cancelled' } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('status change: network error is caught and shows a toast error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'cancelled' } });

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('status Select is disabled for the row currently in flight (statusBusy===item.id)', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'in_progress' } });
    await waitFor(() => expect(select.disabled).toBe(true));
    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('the "issue certificate" button is disabled while that row is statusBusy', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item({ id: 'i3' })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'in_progress' } });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Выдать удостоверение' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );
    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('always mounts two dialogs (AddPositionDialog + IssueCertDialog) when canEdit, none when not', () => {
    const { rerender } = render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: false,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(document.querySelector('dialog')).toBeNull();

    rerender(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    expect(document.querySelectorAll('dialog').length).toBe(2);
  });

  it('"Добавить слушателя" opens the AddPositionDialog', async () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Добавить слушателя' }));
    expect(await screen.findByRole('heading', { name: 'Добавить слушателя' })).toBeTruthy();
  });

  it('AddPositionDialog: cancel calls its onClose (setAddOpen(false))', async () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Добавить слушателя' }));
    await screen.findByRole('heading', { name: 'Добавить слушателя' });

    const dialogEl = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('IssueCertDialog: title interpolates the student name', async () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item({ student: { id: 's1', name: 'Мария Сидорова', email: 'm@example.com' } })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    expect(await screen.findByText('Выдать удостоверение — Мария Сидорова')).toBeTruthy();
  });

  it('IssueCertDialog: submit without number/issuedAt shows the inline validation error, no fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    expect(await screen.findByText('Укажите номер и дату выдачи удостоверения.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('IssueCertDialog: submit success posts number/issuedAt/validUntil, shows toast, closes, router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item({ id: 'i9' })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);

    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-99' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.change(screen.getByLabelText('Действителен до (необязательно)'), {
      target: { value: '2027-05-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/manager/certificates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            orderItemId: 'i9',
            number: 'УТ-99',
            issuedAt: '2024-05-01',
            validUntil: '2027-05-01',
          }),
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Удостоверение выдано'));
    expect(refresh).toHaveBeenCalled();
  });

  it('IssueCertDialog: submit with empty validUntil sends undefined (|| undefined branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item({ id: 'i9' })],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/manager/certificates',
        expect.objectContaining({
          body: JSON.stringify({ orderItemId: 'i9', number: 'УТ-1', issuedAt: '2024-05-01' }),
        })
      )
    );
  });

  it('IssueCertDialog: submit failure (with error body) shows the mapped inline error, no toast', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ error: 'validation' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('IssueCertDialog: submit failure with unparsable json still shows an inline error (catch->{})', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('IssueCertDialog: network error shows the network inline error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('IssueCertDialog: shows the busy label and disables fields while submitting', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));

    expect(await screen.findByText('Сохранение…')).toBeTruthy();
    expect((screen.getByLabelText('Номер удостоверения') as HTMLInputElement).disabled).toBe(true);

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('IssueCertDialog: cancel resets the form and closes when not busy', async () => {
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('IssueCertDialog: cancel is a no-op while busy', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(OrderItemsSection, {
        orderId: 'order-1',
        canEdit: true,
        items: [item()],
        directions: DIRECTIONS,
        students: STUDENTS,
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Выдать удостоверение' }));
    await screen.findByText(/Выдать удостоверение —/);
    fireEvent.change(screen.getByLabelText('Номер удостоверения'), { target: { value: 'УТ-1' } });
    fireEvent.change(screen.getByLabelText('Дата выдачи'), { target: { value: '2024-05-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Выдать' }));
    await screen.findByText('Сохранение…');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    // Still busy — cancel is swallowed by handleClose's `if (!busy)` guard
    expect(screen.getByText('Сохранение…')).toBeTruthy();

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
