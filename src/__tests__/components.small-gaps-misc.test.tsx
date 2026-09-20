// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * Три мелких, но заметных места.
 *
 * «Мои показатели»: **процент печатается только когда есть план** — «0 %» под
 * пустым планом читается как невыполнение того, чего человеку не ставили.
 * Карточка заявки: слушателей столько, сколько **разных людей**, а не позиций
 * — одному человеку может идти несколько обучений одной заявкой (`У-43`).
 * Фильтры очереди разбора: повторяющийся параметр адреса не должен ломать
 * ссылку — берём первое значение.
 */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/manager/exchange/payments',
  useSearchParams: () => new URLSearchParams(),
}));

// Число слушателей уезжает не самой карточке, а кнопкам действий — их и
// подменяем, чтобы прочитать переданное значение.
vi.mock('@/components/enrollment/enrollment-detail-view', () => ({
  EnrollmentDetailView: (props: Record<string, unknown>) => (
    <div data-testid="detail">{props.actions as React.ReactNode}</div>
  ),
  enrollmentTitle: () => 'Заявка',
}));
vi.mock('@/components/enrollment/enrollment-staff-actions', () => ({
  EnrollmentStaffActions: (props: { enrollment: { studentCount: number } }) => (
    <span data-testid="actions" data-students={String(props.enrollment.studentCount)} />
  ),
}));

import { MyKpiGrid } from '@/components/manager/my-kpi-grid';
import { StaffEnrollmentDetail } from '@/components/enrollment/staff-enrollment-detail';
import { PaymentQueueToolbar } from '@/components/import/payment-queue-toolbar';

beforeEach(() => vi.clearAllMocks());

describe('MyKpiGrid — «Мои показатели»', () => {
  const row = (over: Record<string, unknown> = {}) =>
    ({
      key: 'deals',
      label: 'Сделки',
      unit: 'count',
      fact: '5',
      plan: '10',
      percent: 50,
      href: '/manager/deals',
      hint: 'Сколько сделок',
      ...over,
    }) as never;

  it('план задан и процент известен — показываем оба', () => {
    render(<MyKpiGrid rows={[row()]} month="2026-09" />);

    expect(screen.getByText(/План 10 · 50 %/)).toBeTruthy();
  });

  it('план есть, процента нет — «0 %» не выдумываем', () => {
    render(<MyKpiGrid rows={[row({ percent: null })]} month="2026-09" />);

    expect(screen.getByText('План 10')).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('плана нет — так и написано', () => {
    render(<MyKpiGrid rows={[row({ plan: null, percent: null })]} month="2026-09" />);

    expect(screen.getByText('План не задан')).toBeTruthy();
  });

  it('показателей нет — пустой экран, а не пустая таблица', () => {
    render(<MyKpiGrid rows={[]} month="2026-09" />);

    expect(screen.getByTestId('my-kpi')).toBeTruthy();
  });
});

describe('StaffEnrollmentDetail — сколько слушателей в заявке', () => {
  const item = (over: Record<string, unknown> = {}) =>
    ({ id: 'i1', studentId: 's1', fullName: 'Иванов', status: 'pending', ...over }) as never;

  it('один человек на двух обучениях считается одним', () => {
    render(
      <StaffEnrollmentDetail
        cabinet="manager"
        detail={
          {
            id: 'e1',
            items: [item(), item({ id: 'i2' })],
          } as never
        }
      />
    );

    expect(screen.getByTestId('actions').dataset.students).toBe('1');
  });

  it('человек без карточки слушателя считается по имени', () => {
    render(
      <StaffEnrollmentDetail
        cabinet="admin"
        detail={
          {
            id: 'e1',
            items: [
              item({ studentId: null, fullName: 'Петров' }),
              item({ studentId: null, fullName: 'Сидоров' }),
            ],
          } as never
        }
      />
    );

    expect(screen.getByTestId('actions').dataset.students).toBe('2');
  });
});

describe('PaymentQueueToolbar — фильтры очереди разбора', () => {
  it('повторяющийся параметр адреса не ломает ссылку — берём первое значение', () => {
    render(
      <PaymentQueueToolbar
        basePath="/manager/exchange/payments"
        searchParams={{ reason: ['none', 'name_fuzzy'] }}
        total={10}
        take={20}
        skip={0}
      />
    );

    // Экран отрисовался, а не упал на массиве вместо строки.
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('обычный одиночный параметр работает как прежде', () => {
    render(
      <PaymentQueueToolbar
        basePath="/manager/exchange/payments"
        searchParams={{ reason: 'none' }}
        total={10}
        take={20}
        skip={0}
      />
    );

    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
