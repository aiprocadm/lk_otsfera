// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import type { EnrollmentRow, EnrollmentItemRow } from '@/lib/services/enrollments/list';

function item(overrides: Partial<EnrollmentItemRow> = {}): EnrollmentItemRow {
  return {
    id: 'i1',
    studentId: null,
    fullName: 'Иван Петров',
    email: 'ivan@example.com',
    position: null,
    snils: null,
    birthDate: null,
    extra: null,
    status: 'pending',
    externalStudentId: null,
    ...overrides,
  };
}

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1',
    directionName: 'Охрана труда',
    studentCount: 1,
    firstStudentName: 'Иван Петров',
    items: [item()],
    status: 'pending',
    organizationId: null,
    organizationName: null,
    partnerName: null,
    submitterRole: 'partner',
    submittedByName: 'Партнёр 1',
    rejectedReason: null,
    note: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    reviewedAt: null,
    ...overrides,
  };
}

/** Заявка «зачислены» с двумя provisioned-позициями. */
function provisionedRow(): EnrollmentRow {
  return row({
    status: 'provisioned',
    studentCount: 2,
    items: [
      item({ id: 'i1', status: 'provisioned' }),
      item({
        id: 'i2',
        fullName: 'Анна Иванова',
        email: 'anna@example.com',
        status: 'provisioned',
      }),
    ],
  });
}

function lastPatchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls.at(-1)!;
  return JSON.parse((call[1] as { body: string }).body);
}

describe('EnrollmentQueue — bulk-переходы позиций (PR-2)', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('provisioned-позиции → кнопка «Идёт обучение»; клик без чекбоксов шлёт PATCH без itemIds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [provisionedRow()] }));

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отмечено: идёт обучение'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enrollments/e1',
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'markInTraining' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('с отмеченным чекбоксом: PATCH уходит с itemIds=[выбранный id]', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [provisionedRow()] }));

    // Раскрываем строку и отмечаем одну позицию
    fireEvent.click(screen.getByText(/2 слушателя — показать/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать позицию: Анна Иванова' }));

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'markInTraining', itemIds: ['i2'] });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отмечено: идёт обучение'));
  });

  it('снятый обратно чекбокс не попадает в itemIds (пустой выбор → без itemIds)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [provisionedRow()] }));

    fireEvent.click(screen.getByText(/2 слушателя — показать/));
    const cb = screen.getByRole('checkbox', { name: 'Выбрать позицию: Анна Иванова' });
    fireEvent.click(cb);
    fireEvent.click(cb); // снимаем отметку

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'markInTraining' });
  });

  it('in_training-позиции → кнопка «Удостоверения готовы» шлёт markCertificatesReady', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [
          row({
            status: 'in_training',
            studentCount: 2,
            items: [
              item({ id: 'i1', status: 'in_training' }),
              item({
                id: 'i2',
                fullName: 'Анна Иванова',
                email: 'anna@example.com',
                status: 'in_training',
              }),
            ],
          }),
        ],
      })
    );
    expect(screen.queryByRole('button', { name: 'Идёт обучение' })).toBeNull();

    fireEvent.click(screen.getByText(/показать/));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Выбрать позицию: Иван Петров' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удостоверения готовы' }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('Отмечено: удостоверения готовы')
    );
    expect(lastPatchBody(fetchMock)).toEqual({ action: 'markCertificatesReady', itemIds: ['i1'] });
  });

  it('смешанные позиции: обе кнопки видны, чекбоксы только у provisioned/in_training', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(
      React.createElement(EnrollmentQueue, {
        rows: [
          row({
            status: 'provisioned',
            studentCount: 3,
            items: [
              item({ id: 'i1', status: 'provisioned' }),
              item({
                id: 'i2',
                fullName: 'Анна Иванова',
                email: 'anna@example.com',
                status: 'in_training',
              }),
              item({
                id: 'i3',
                fullName: 'Пётр Сидоров',
                email: 'petr@example.com',
                status: 'rejected',
              }),
            ],
          }),
        ],
      })
    );
    expect(screen.getByRole('button', { name: 'Идёт обучение' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Удостоверения готовы' })).toBeTruthy();

    fireEvent.click(screen.getByText(/показать/));
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Выбрать позицию: Иван Петров' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Выбрать позицию: Анна Иванова' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Выбрать позицию: Пётр Сидоров' })).toBeNull();
  });

  it('у pending-заявки кнопок переходов нет', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));
    expect(screen.queryByRole('button', { name: 'Идёт обучение' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Удостоверения готовы' })).toBeNull();
  });

  it('ошибка ответа сервера → toast.error с кодом, refresh не зовётся', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'lifecycle_violation' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [provisionedRow()] }));

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: lifecycle_violation'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('сетевая ошибка → «Сетевая ошибка»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    render(React.createElement(EnrollmentQueue, { rows: [provisionedRow()] }));

    fireEvent.click(screen.getByRole('button', { name: 'Идёт обучение' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });
});
