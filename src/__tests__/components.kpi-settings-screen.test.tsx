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

  it('копирование не удалось — отказ показывается, планы не «скопированы» молча', async () => {
    // Успешный тост при отказе — худший исход: человек уверен, что планы на
    // месте, и обнаружит пустую таблицу только в конце месяца.
    copyTargets.mockResolvedValueOnce({ ok: false, error: 'forbidden' });
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать с прошлого месяца' }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('отказ БЕЗ кода причины всё равно объясняется словами', async () => {
    // Действие может вернуть `{ ok: false }` без поля `error` (например, из
    // общей обёртки). Без запасного значения человек увидел бы пустой тост.
    setActive.mockResolvedValueOnce({ ok: false });
    render(React.createElement(KpiSettingsScreen, { view: view() }));
    fireEvent.click(screen.getByTestId('metric-certificates_issued'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const text = String(toastError.mock.calls[0][0]);
    expect(text.length).toBeGreaterThan(5);
    expect(/[а-яА-Я]/.test(text)).toBe(true);
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

/**
 * Мелочи экрана настроек показателей (`У-242`), из-за которых он врёт тихо.
 *
 * **Единица измерения подписывает поле плана.** «1000» без подписи читается
 * как рубли; для среднего времени ответа это минуты, и разница между «план
 * 30 ₽» и «план 30 мин» — не косметика.
 *
 * **Снятая галочка показателя уходит на сервер вместе со всем набором.**
 * Действие принимает список целиком: пришли мы только снятый ключ — сервер
 * решил бы, что человек оставил один показатель.
 */
describe('KpiSettingsScreen — подписи и снятие галочки', () => {
  it('у показателя в минутах поле плана подписано «мин», а не «₽»', () => {
    render(
      React.createElement(KpiSettingsScreen, {
        view: view({
          available: [
            {
              key: 'avg_first_response_min',
              label: 'Среднее время ответа',
              hint: 'Минуты.',
              unit: 'minutes',
              perManager: false,
            },
          ],
          active: ['avg_first_response_min'],
        }),
      })
    );

    // Подпись стоит в скобках рядом с названием показателя, поэтому ищем по
    // содержимому, а не по точному совпадению узла.
    expect(document.body.textContent).toContain('(мин)');
  });

  it('снятая галочка уходит НАБОРОМ без неё, а не одним ключом', async () => {
    render(React.createElement(KpiSettingsScreen, { view: view({ active: ['revenue_paid'] }) }));

    fireEvent.click(screen.getByTestId('metric-revenue_paid'));

    await waitFor(() => expect(setActive).toHaveBeenCalled());
    const fd = setActive.mock.calls[0]![0] as FormData;
    expect(fd.getAll('metric')).toEqual([]);
  });

  it('добавленная галочка приходит вместе с уже выбранными', async () => {
    render(React.createElement(KpiSettingsScreen, { view: view({ active: ['revenue_paid'] }) }));

    fireEvent.click(screen.getByTestId('metric-certificates_issued'));

    await waitFor(() => expect(setActive).toHaveBeenCalled());
    const fd = setActive.mock.calls[0]![0] as FormData;
    expect(fd.getAll('metric')).toEqual(['revenue_paid', 'certificates_issued']);
  });
});
