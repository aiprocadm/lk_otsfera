// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { EnrollmentRequestForm } from '@/components/enrollment/enrollment-request-form';

describe('EnrollmentRequestForm', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render the organization select when organizations is omitted', () => {
    render(React.createElement(EnrollmentRequestForm, {}));
    expect(screen.queryByText('Организация (необязательно)')).toBeNull();
  });

  it('does not render the organization select when organizations is an empty array', () => {
    render(React.createElement(EnrollmentRequestForm, { organizations: [] }));
    expect(screen.queryByText('Организация (необязательно)')).toBeNull();
  });

  it('renders the organization select with options when organizations is non-empty', () => {
    render(
      React.createElement(EnrollmentRequestForm, {
        organizations: [
          { id: 'o1', name: 'ООО Ромашка' },
          { id: 'o2', name: 'ООО Лютик' }
        ]
      })
    );
    expect(screen.getByText('Организация (необязательно)')).toBeTruthy();
    expect(screen.getByText('ООО Ромашка')).toBeTruthy();
    expect(screen.getByText('ООО Лютик')).toBeTruthy();
  });

  it('submit success: posts trimmed/derived fields, resets the form, shows success toast, router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, { organizations: [{ id: 'o1', name: 'ООО Ромашка' }] }));

    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'Иван Петров' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'ivan@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Охрана труда' } });
    fireEvent.change(screen.getByPlaceholderText('Примечание (необязательно)'), { target: { value: 'срочно' } });
    fireEvent.change(screen.getByText('Организация (необязательно)').closest('select')!, { target: { value: 'o1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка на обучение отправлена'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enrollments',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          studentName: 'Иван Петров',
          studentEmail: 'ivan@example.com',
          courseTitle: 'Охрана труда',
          organizationId: 'o1',
          note: 'срочно'
        })
      })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());

    // Fields reset after success
    expect((screen.getByPlaceholderText('ФИО слушателя') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('Email слушателя') as HTMLInputElement).value).toBe('');
  });

  it('submit with empty organizationId and empty note sends null for both', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, {}));

    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'Пётр Иванов' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'petr@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Пожарная безопасность' } });

    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments',
        expect.objectContaining({
          body: JSON.stringify({
            studentName: 'Пётр Иванов',
            studentEmail: 'petr@example.com',
            courseTitle: 'Пожарная безопасность',
            organizationId: null,
            note: null
          })
        })
      )
    );
  });

  it('submit failure (with error json) shows the error toast and does NOT reset the form', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'invalid' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, {}));
    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'Иван Петров' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'ivan@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Охрана труда' } });

    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось отправить заявку: invalid'));
    expect((screen.getByPlaceholderText('ФИО слушателя') as HTMLInputElement).value).toBe('Иван Петров');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('submit failure with unparsable json falls back to the status code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json');
      }
    });
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, {}));
    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось отправить заявку: 500'));
  });

  it('network error shows a generic network-error toast', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, {}));
    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('the submit button is disabled while busy', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(React.createElement(EnrollmentRequestForm, {}));
    fireEvent.change(screen.getByPlaceholderText('ФИО слушателя'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Email слушателя'), { target: { value: 'x@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Курс / программа'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /Отправить заявку/ }) as HTMLButtonElement).disabled).toBe(true)
    );
    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
