// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const { setActive, upsertTarget, copyTargets, toastError, toastSuccess, refresh } = vi.hoisted(
  () => ({
    setActive: vi.fn(),
    upsertTarget: vi.fn(),
    copyTargets: vi.fn(),
    toastError: vi.fn(),
    toastSuccess: vi.fn(),
    refresh: vi.fn(),
  })
);
vi.mock('@/server-actions/kpi', () => ({
  setActiveMetricsAction: setActive,
  upsertKpiTargetAction: upsertTarget,
  copyKpiTargetsAction: copyTargets,
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { KpiSettingsScreen } from '@/components/kpi/kpi-settings-screen';
import type { KpiSettingsView } from '@/lib/services/kpi/settings';

function view(over: Partial<KpiSettingsView> = {}): KpiSettingsView {
  return {
    available: [
      {
        key: 'revenue_paid',
        label: 'Оплачено',
        hint: 'Деньги за период.',
        unit: 'money',
        perManager: true,
      },
      {
        key: 'certificates_issued',
        label: 'Удостоверения выданы',
        hint: 'Выдано за период.',
        unit: 'count',
        perManager: false,
      },
    ],
    active: ['revenue_paid'],
    managers: [
      { id: 'u1', name: 'Иванов', isActive: true },
      { id: 'u2', name: 'Петров', isActive: false },
    ],
    targets: { 'revenue_paid:u1': '1000.00' },
    year: 2026,
    month: 9,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setActive.mockResolvedValue({ ok: true });
  upsertTarget.mockResolvedValue({ ok: true });
  copyTargets.mockResolvedValue({ ok: true, copied: 3 });
});
afterEach(() => cleanup());

describe('KpiSettingsScreen', () => {
  it('объясняет, что здесь делают, и показывает выбор с подсказками (§15)', () => {
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    expect(screen.getByRole('heading', { name: 'Показатели и планы' })).toBeTruthy();
    expect(screen.getByText(/поставьте план каждому менеджеру/)).toBeTruthy();
    expect(screen.getByText('Деньги за период.')).toBeTruthy();
    // У показателя без ответственного сказано прямо, почему у него нет людей.
    expect(screen.getByText(/ответственного у этих данных нет/)).toBeTruthy();
  });

  it('галочка показателя уходит в действие вместе со всем набором', async () => {
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByTestId('metric-certificates_issued'));
    await waitFor(() => expect(setActive).toHaveBeenCalled());
    const fd = setActive.mock.calls[0][0] as FormData;
    expect(fd.getAll('metric')).toEqual(['revenue_paid', 'certificates_issued']);
    expect(refresh).toHaveBeenCalled();
  });

  it('план сохраняется при уходе из поля; уволенный помечен', async () => {
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    expect(screen.getByText(/Петров/).textContent).toContain('не работает');
    const input = screen.getByTestId('target-revenue_paid-u1') as HTMLInputElement;
    expect(input.value).toBe('1000.00');
    fireEvent.blur(input, { target: { value: '2500' } });
    await waitFor(() => expect(upsertTarget).toHaveBeenCalled());
    const fd = upsertTarget.mock.calls[0][0] as FormData;
    expect(fd.get('metric')).toBe('revenue_paid');
    expect(fd.get('managerId')).toBe('u1');
    expect(fd.get('amount')).toBe('2500');
  });

  it('у показателя без ответственного план ставится на компанию', async () => {
    render(
      React.createElement(KpiSettingsScreen, {
        view: view({ active: ['revenue_paid', 'certificates_issued'] }),
      })
    );
    fireEvent.blur(screen.getByTestId('target-certificates_issued-company'), {
      target: { value: '40' },
    });
    await waitFor(() => expect(upsertTarget).toHaveBeenCalled());
    expect((upsertTarget.mock.calls[0][0] as FormData).get('managerId')).toBe('');
  });

  it('«Скопировать с прошлого месяца» зовёт действие с текущим периодом', async () => {
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать с прошлого месяца' }));
    await waitFor(() => expect(copyTargets).toHaveBeenCalled());
    const fd = copyTargets.mock.calls[0][0] as FormData;
    expect(fd.get('year')).toBe('2026');
    expect(fd.get('month')).toBe('9');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('ничего не выбрано — объяснение и что нажать, а не пустая рамка (У-74)', () => {
    render(React.createElement(KpiSettingsScreen, { view: view({ active: [] }) }));
    expect(screen.getByText('Показатели не выбраны')).toBeTruthy();
    expect(screen.getByText(/Отметьте выше/)).toBeTruthy();
  });

  it('перебор показателей — понятная русская подсказка, а не код', async () => {
    setActive.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByTestId('metric-certificates_issued'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain('восьми');
  });

  it('незнакомый код и сетевой сбой тоже объясняются словами', async () => {
    setActive.mockResolvedValueOnce({ ok: false, error: 'какой_то_новый' });
    const { unmount } = render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByTestId('metric-certificates_issued'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0]).length).toBeGreaterThan(5);
    unmount();

    setActive.mockRejectedValueOnce(new Error('offline'));
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByTestId('metric-certificates_issued'));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Сетевая ошибка'));
  });
});
