// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { TrainingDirection } from '@prisma/client';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { DirectionsAdmin } from '@/components/training/directions-admin';

function direction(overrides: Partial<TrainingDirection> = {}): TrainingDirection {
  return {
    id: 'd1',
    name: 'Охрана труда',
    sortOrder: 1,
    isActive: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides
  } as TrainingDirection;
}

describe('DirectionsAdmin', () => {
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

  it('renders the "no directions" row when the list is empty', () => {
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    expect(screen.getByText('Нет направлений')).toBeTruthy();
  });

  it('renders a row per direction with active badge and name/order', () => {
    render(
      React.createElement(DirectionsAdmin, {
        directions: [direction({ isActive: true }), direction({ id: 'd2', name: 'ПБ', isActive: false })]
      })
    );
    expect(screen.getByText('Охрана труда')).toBeTruthy();
    expect(screen.getByText('ПБ')).toBeTruthy();
    expect(screen.getByText('Да')).toBeTruthy();
    expect(screen.getByText('Нет')).toBeTruthy();
  });

  it('only active directions show the "Деактивировать" button', () => {
    render(
      React.createElement(DirectionsAdmin, {
        directions: [direction({ id: 'd1', isActive: true }), direction({ id: 'd2', isActive: false })]
      })
    );
    expect(screen.getAllByRole('button', { name: 'Деактивировать' }).length).toBe(1);
  });

  it('opening the add dialog and submitting posts name/sortOrder, shows toast, closes, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [] }));

    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    expect(await screen.findByText('Новое направление')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: '  Электробезопасность  ' } });
    fireEvent.change(screen.getByLabelText('Порядок сортировки'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/training-directions',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Электробезопасность', sortOrder: 5 })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Направление добавлено.'));
    // Both add/edit dialogs stay mounted (only `open` toggles) — assert the
    // native close() was invoked, per the Dialog exemplar's imperative pattern.
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('add with an empty sortOrder field defaults to 0 (Number(fd.get(...) || 0) branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое направление');

    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText('Порядок сортировки'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/training-directions',
        expect.objectContaining({ body: JSON.stringify({ name: 'X', sortOrder: 0 }) })
      )
    );
  });

  it('add failure (with error body) shows the mapped toast error, dialog stays open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'validation' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое направление');
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('Новое направление')).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('add failure with unparsable json still shows a toast error (catch->{} fallback)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое направление');
    fireEvent.change(screen.getByLabelText('Название'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('cancel closes the add dialog without submitting', async () => {
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое направление');
    fireEvent.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  // Both the add and edit <dialog>s are always mounted (only `open` toggles),
  // and both contain a "Название"/"Порядок сортировки" field with the same
  // label text — scope queries to the currently-open <dialog> to disambiguate.
  function openEditDialog(): HTMLElement {
    return document.querySelector('dialog[open]') as HTMLElement;
  }

  it('opening the edit dialog pre-fills name/sortOrder from the target direction', async () => {
    render(React.createElement(DirectionsAdmin, { directions: [direction({ name: 'Старое имя', sortOrder: 7 })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    expect(await screen.findByText('Изменить направление')).toBeTruthy();
    const dialogEl = openEditDialog();
    expect((within(dialogEl).getByLabelText('Название') as HTMLInputElement).value).toBe('Старое имя');
    expect((within(dialogEl).getByLabelText('Порядок сортировки') as HTMLInputElement).value).toBe('7');
  });

  it('edit success: PATCHes the direction id with new name/sortOrder, shows toast, closes, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction({ id: 'd9' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    const dialogEl = openEditDialog();

    fireEvent.change(within(dialogEl).getByLabelText('Название'), { target: { value: 'Новое имя' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/training-directions/d9',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ name: 'Новое имя', sortOrder: 1 }) })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Направление обновлено.'));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('edit with an empty sortOrder field defaults to 0 (Number(fd.get(...) || 0) branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction({ id: 'd9' })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    const dialogEl = openEditDialog();

    fireEvent.change(within(dialogEl).getByLabelText('Порядок сортировки'), { target: { value: '' } });
    fireEvent.click(within(dialogEl).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/training-directions/d9',
        expect.objectContaining({ body: JSON.stringify({ name: direction().name, sortOrder: 0 }) })
      )
    );
  });

  it('edit failure with a body lacking an `error` field falls back to the empty-string code (?? \'\' branch)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    fireEvent.click(within(openEditDialog()).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });

  it('edit failure shows the mapped toast error and keeps the dialog open', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'not_found' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    fireEvent.click(within(openEditDialog()).getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('Изменить направление')).toBeTruthy();
  });

  it('cancel closes the edit dialog', async () => {
    render(React.createElement(DirectionsAdmin, { directions: [direction()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    fireEvent.click(within(openEditDialog()).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('Escape closes the add dialog via the Dialog primitive\'s onClose prop', async () => {
    render(React.createElement(DirectionsAdmin, { directions: [] }));
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }));
    await screen.findByText('Новое направление');
    await waitFor(() => expect(document.querySelector('dialog[open]')).toBeTruthy());
    const dialogEl = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('Escape closes the edit dialog via the Dialog primitive\'s onClose prop', async () => {
    render(React.createElement(DirectionsAdmin, { directions: [direction()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Изменить' }));
    await screen.findByText('Изменить направление');
    const dialogEl = openEditDialog();
    fireEvent(dialogEl, new Event('cancel', { cancelable: true }));
    await waitFor(() => expect(HTMLDialogElement.prototype.close).toHaveBeenCalled());
  });

  it('deactivate success: DELETEs the direction id, shows toast, refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction({ id: 'd5', isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/training-directions/d5', { method: 'DELETE' })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Направление деактивировано.'));
    expect(refresh).toHaveBeenCalled();
  });

  it('deactivate failure (with error body) shows the mapped toast error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'forbidden' }) });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction({ isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(refresh).not.toHaveBeenCalled();
  });

  it('deactivate failure with unparsable json still shows a toast error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(DirectionsAdmin, { directions: [direction({ isActive: true })] }));
    fireEvent.click(screen.getByRole('button', { name: 'Деактивировать' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
