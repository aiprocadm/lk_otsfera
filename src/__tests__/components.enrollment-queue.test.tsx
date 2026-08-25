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
    directionName: 'Охрана труда',
    ...overrides,
  };
}

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1',
    directionName: 'Охрана труда',
    directionNames: ['Охрана труда'],
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

describe('EnrollmentQueue', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the empty state when there are no rows', () => {
    render(
      React.createElement(EnrollmentQueue, { rows: [], cardHrefBase: '/manager/enrollments' })
    );
    expect(screen.getByText('Заявок на обучение нет')).toBeTruthy();
  });

  it('renders partnerName preferentially over organizationName/submittedByName, with submitterRole below', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [
          row({
            partnerName: 'ООО Партнёр',
            organizationName: 'ООО Заказчик',
            submitterRole: 'partner',
          }),
        ],
      })
    );
    expect(screen.getByText('ООО Партнёр')).toBeTruthy();
    expect(screen.getByText('partner')).toBeTruthy();
  });

  it('falls back to organizationName when partnerName is null', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ partnerName: null, organizationName: 'ООО Заказчик' })],
      })
    );
    expect(screen.getByText('ООО Заказчик')).toBeTruthy();
  });

  it('falls back to submittedByName when both partnerName and organizationName are null', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ partnerName: null, organizationName: null, submittedByName: 'Сам подал' })],
      })
    );
    expect(screen.getByText('Сам подал')).toBeTruthy();
  });

  it('раскрытие позиций: доп. поля и LMS-id видны, повторный клик сворачивает', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [
          row({
            status: 'provisioned',
            note: 'спешно',
            items: [
              item({
                position: 'инженер',
                snils: '11223344595',
                birthDate: new Date('1990-01-02T00:00:00Z'),
                extra: 'нужна параллельная группа',
                status: 'provisioned',
                externalStudentId: 'LMS-42',
              }),
            ],
          }),
        ],
      })
    );
    fireEvent.click(screen.getByText(/показать/));
    expect(screen.getByText('ivan@example.com')).toBeTruthy();
    expect(screen.getByText(/инженер/)).toBeTruthy();
    expect(screen.getByText(/СНИЛС 11223344595/)).toBeTruthy();
    expect(screen.getByText(/нужна параллельная группа/)).toBeTruthy();
    expect(screen.getByText('LMS: LMS-42')).toBeTruthy();
    expect(screen.getByText(/Примечание: спешно/)).toBeTruthy();

    fireEvent.click(screen.getByText('Свернуть'));
    expect(screen.queryByText('ivan@example.com')).toBeNull();
  });

  it('У-43: колонка перечисляет все обучения заявки, раскрытие группирует позиции', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [
          row({
            directionNames: ['Охрана труда', 'Работы на высоте'],
            studentCount: 2,
            items: [
              item({ id: 'i1', directionName: 'Охрана труда' }),
              item({ id: 'i2', fullName: 'Пётр Сидоров', directionName: 'Работы на высоте' }),
            ],
          }),
        ],
      })
    );
    // В колонке «Направление» — оба обучения, а не одно с шапки.
    expect(screen.getByText('Охрана труда')).toBeTruthy();
    expect(screen.getByText('Работы на высоте')).toBeTruthy();

    fireEvent.click(screen.getByText(/показать/));
    // Внутри каждой группы нумерация своя — оба слушателя под номером 1.
    expect(screen.getByText('1. Иван Петров')).toBeTruthy();
    expect(screen.getByText('1. Пётр Сидоров')).toBeTruthy();
  });

  it('заявка совсем без позиций: колонка берёт направление шапки', () => {
    // Позиций может не быть у очень старой заявки; строка очереди обязана
    // остаться читаемой, а не показать пустую колонку.
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ directionNames: [], items: [], studentCount: 0 })],
      })
    );
    expect(screen.getByText('Охрана труда')).toBeTruthy();
  });

  it('счётчик «и ещё N» для многопозиционной заявки', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ studentCount: 3, items: [item(), item({ id: 'i2' }), item({ id: 'i3' })] })],
      })
    );
    expect(screen.getByText(/и ещё 2/)).toBeTruthy();
    expect(screen.getByText(/3 слушателя — показать/)).toBeTruthy();
  });

  it('заявка без имени первого слушателя показывает прочерк, а не пустую строку', () => {
    // Имя может отсутствовать: заявка старого формата или позиции ещё не
    // заполнены. Строка очереди обязана остаться кликабельной и читаемой.
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ firstStudentName: null, studentCount: 1 })],
      })
    );
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('pending row shows Утвердить + Отклонить, but not Зачислены', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );
    expect(screen.getByRole('button', { name: 'Утвердить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Зачислены' })).toBeNull();
  });

  it('approved row shows Зачислены + Отклонить, but not Утвердить', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'approved' })],
        cardHrefBase: '/manager/enrollments',
      })
    );
    expect(screen.getByRole('button', { name: 'Зачислены' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Утвердить' })).toBeNull();
  });

  it('rejected/provisioned rows show no action buttons (+ причина отклонения в строке)', () => {
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ status: 'rejected', rejectedReason: 'Неполные данные' })],
      })
    );
    expect(screen.queryByRole('button', { name: 'Утвердить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Зачислены' })).toBeNull();
    expect(screen.getByText('Неполные данные')).toBeTruthy();
  });

  it('approve action: PATCH success shows success toast and router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка утверждена'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enrollments/e1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ action: 'approve' }) })
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('approve action: PATCH failure (with error json) shows error toast with server error code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'not_found' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: not_found'));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('approve action: PATCH failure with unparsable json falls back to status code in message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('bad json');
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: 500'));
  });

  it('approve action: network error shows generic network-error toast', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('markProvisioned (одна позиция): prompt обязателен, отправляется trimmed id', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('  LMS-7  ');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'approved' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    expect(promptSpy).toHaveBeenCalledWith('ID слушателя в LMS (externalStudentId):');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'markProvisioned', externalStudentId: 'LMS-7' }),
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отмечено: зачислены'));
  });

  it('markProvisioned (несколько позиций): пустой ответ prompt допустим', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        cardHrefBase: '/manager/enrollments',
        rows: [row({ status: 'approved', studentCount: 2, items: [item(), item({ id: 'i2' })] })],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({
          body: JSON.stringify({ action: 'markProvisioned', externalStudentId: '' }),
        })
      )
    );
  });

  it('markProvisioned: prompt cancelled (null) does not call fetch', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'approved' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('markProvisioned (одна позиция): whitespace-only value does not call fetch (trim guard)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'approved' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зачислены' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reject action: prompt with any string (including empty) calls PATCH with the reason', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Причина отказа');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'reject', reason: 'Причина отказа' }),
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка отклонена'));
  });

  it('reject action: empty-string reason still calls PATCH (only null/cancel blocks it)', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({ body: JSON.stringify({ action: 'reject', reason: '' }) })
      )
    );
  });

  it('reject action: prompt cancelled (null) does not call fetch', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the loading state on the busy row action button while a PATCH is in flight', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'pending' })],
        cardHrefBase: '/manager/enrollments',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));
    // Button becomes disabled while busy (loading prop wired through to Button)
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Утвердить' }) as HTMLButtonElement).disabled
      ).toBe(true)
    );

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
