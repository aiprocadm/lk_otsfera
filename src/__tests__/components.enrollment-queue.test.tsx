// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

import { EnrollmentQueue } from '@/components/enrollment/enrollment-queue';
import type { EnrollmentRow } from '@/lib/services/enrollments/list';

function row(overrides: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    id: 'e1',
    studentName: 'Иван Петров',
    studentEmail: 'ivan@example.com',
    courseTitle: 'Охрана труда',
    status: 'pending',
    organizationId: null,
    organizationName: null,
    partnerName: null,
    submitterRole: 'partner',
    submittedByName: 'Партнёр 1',
    externalStudentId: null,
    rejectedReason: null,
    note: null,
    createdAt: new Date('2024-01-15T10:00:00Z'),
    reviewedAt: null,
    ...overrides
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
    render(React.createElement(EnrollmentQueue, { rows: [] }));
    expect(screen.getByText('Заявок на обучение нет')).toBeTruthy();
  });

  it('renders partnerName preferentially over organizationName/submittedByName, with submitterRole below', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ partnerName: 'ООО Партнёр', organizationName: 'ООО Заказчик', submitterRole: 'partner' })]
      })
    );
    expect(screen.getByText('ООО Партнёр')).toBeTruthy();
    expect(screen.getByText('partner')).toBeTruthy();
  });

  it('falls back to organizationName when partnerName is null', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ partnerName: null, organizationName: 'ООО Заказчик' })]
      })
    );
    expect(screen.getByText('ООО Заказчик')).toBeTruthy();
  });

  it('falls back to submittedByName when both partnerName and organizationName are null', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ partnerName: null, organizationName: null, submittedByName: 'Сам подал' })]
      })
    );
    expect(screen.getByText('Сам подал')).toBeTruthy();
  });

  it('shows the LMS externalStudentId note only when status=provisioned AND externalStudentId set', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'provisioned', externalStudentId: 'LMS-42' })]
      })
    );
    expect(screen.getByText('LMS: LMS-42')).toBeTruthy();
  });

  it('does not show the LMS note when provisioned but externalStudentId is null', () => {
    render(
      React.createElement(EnrollmentQueue, {
        rows: [row({ status: 'provisioned', externalStudentId: null })]
      })
    );
    expect(screen.queryByText(/^LMS:/)).toBeNull();
  });

  it('pending row shows Утвердить + Отклонить, but not Заведён в LMS', () => {
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));
    expect(screen.getByRole('button', { name: 'Утвердить' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Заведён в LMS' })).toBeNull();
  });

  it('approved row shows Заведён в LMS + Отклонить, but not Утвердить', () => {
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'approved' })] }));
    expect(screen.getByRole('button', { name: 'Заведён в LMS' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отклонить' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Утвердить' })).toBeNull();
  });

  it('rejected/provisioned rows show no action buttons', () => {
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'rejected' })] }));
    expect(screen.queryByRole('button', { name: 'Утвердить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отклонить' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Заведён в LMS' })).toBeNull();
  });

  it('approve action: PATCH success shows success toast and router.refresh()', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

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
      json: async () => ({ error: 'not_found' })
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

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
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Не удалось: 500'));
  });

  it('approve action: network error shows generic network-error toast', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });

  it('markProvisioned: prompt with a non-empty id calls PATCH with trimmed externalStudentId', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('  LMS-7  ');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'approved' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Заведён в LMS' }));

    expect(promptSpy).toHaveBeenCalledWith('ID слушателя в LMS (externalStudentId):');
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'markProvisioned', externalStudentId: 'LMS-7' })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Отмечено: заведён в LMS'));
  });

  it('markProvisioned: prompt cancelled (null) does not call fetch', () => {
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'approved' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Заведён в LMS' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('markProvisioned: prompt with whitespace-only value does not call fetch (trim guard)', () => {
    vi.spyOn(window, 'prompt').mockReturnValue('   ');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'approved' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Заведён в LMS' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reject action: prompt with any string (including empty) calls PATCH with the reason', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('Причина отказа');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Отклонить' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/enrollments/e1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ action: 'reject', reason: 'Причина отказа' })
        })
      )
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Заявка отклонена'));
  });

  it('reject action: empty-string reason still calls PATCH (only null/cancel blocks it)', async () => {
    vi.spyOn(window, 'prompt').mockReturnValue('');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

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
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

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
    render(React.createElement(EnrollmentQueue, { rows: [row({ status: 'pending' })] }));

    fireEvent.click(screen.getByRole('button', { name: 'Утвердить' }));
    // Button becomes disabled while busy (loading prop wired through to Button)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Утвердить' }) as HTMLButtonElement).disabled).toBe(true));

    resolveFetch({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
