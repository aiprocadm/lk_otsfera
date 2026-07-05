// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess } }));

import { AddPositionDialog } from '@/components/training/add-position-dialog';

const DIRECTIONS = [
  { id: 'd1', name: 'Охрана труда' },
  { id: 'd2', name: 'Пожарная безопасность' }
];
const STUDENTS = [
  { id: 's1', name: 'Иван Петров', email: 'ivan@example.com' },
  { id: 's2', name: 'Пётр Иванов', email: 'petr@example.com' }
];

describe('AddPositionDialog', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();

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

  it('renders student and direction options when open', async () => {
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    expect(await screen.findByText('Добавить слушателя')).toBeTruthy();
    expect(screen.getByText('Иван Петров (ivan@example.com)')).toBeTruthy();
    expect(screen.getByText('Охрана труда')).toBeTruthy();
  });

  it('does not render dialog content structure when closed (Dialog itself gates via showModal)', () => {
    render(
      React.createElement(AddPositionDialog, {
        open: false,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
  });

  it('submitting with no student/direction selected shows the inline validation error, no fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Выберите слушателя и направление.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submit success: posts studentId/directionId/note, shows toast, resets form, closes, router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose,
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');

    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.change(screen.getByLabelText('Примечание (необязательно)'), { target: { value: '  срочно  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/manager/orders/order-1/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ studentId: 's1', directionId: 'd1', note: 'срочно' })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Слушатель добавлен'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('submit with an empty note sends note: undefined (trim-to-empty branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/manager/orders/order-1/items',
        expect.objectContaining({ body: JSON.stringify({ studentId: 's1', directionId: 'd1' }) })
      )
    );
  });

  it('submit failure (with error json) shows the mapped server error, does not close', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'forbidden' }) });
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose,
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('submit failure with unparsable json falls back to the "unknown" error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('network error is caught and shows the network error message', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('shows the busy label and disables fields while submitting', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose: vi.fn(),
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

    expect(await screen.findByText('Добавление…')).toBeTruthy();
    expect((screen.getByLabelText('Слушатель') as HTMLSelectElement).disabled).toBe(true);

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('cancel button resets the form and calls onClose when not busy', async () => {
    const onClose = vi.fn();
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose,
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('cancel is a no-op while busy (handleClose guard)', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const onClose = vi.fn();
    render(
      React.createElement(AddPositionDialog, {
        open: true,
        onClose,
        orderId: 'order-1',
        directions: DIRECTIONS,
        students: STUDENTS
      })
    );
    await screen.findByText('Добавить слушателя');
    fireEvent.change(screen.getByLabelText('Слушатель'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('Направление обучения'), { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    await screen.findByText('Добавление…');

    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    expect(onClose).not.toHaveBeenCalled();

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
