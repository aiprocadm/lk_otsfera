// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { fmtMoney } from '@/lib/format';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: toastSuccess, error: toastError } }));

const { upsertSalesTargetAction } = vi.hoisted(() => ({ upsertSalesTargetAction: vi.fn() }));
vi.mock('@/server-actions/leader/analytics', () => ({ upsertSalesTargetAction }));

import { MonthPicker } from '@/components/leader/analytics/month-picker';
import { FunnelAnalyticsPanel } from '@/components/leader/analytics/funnel-analytics-panel';
import { PlanFactTable } from '@/components/leader/analytics/plan-fact-table';
import type { StageSnapshot, CohortStats, ManagerFunnelRow, PlanFactRow, PlanFactTotals } from '@/lib/services/leader/analytics';

describe('MonthPicker', () => {
  it('renders a GET-form month input pre-filled with the given period and a submit button', () => {
    render(<MonthPicker month='2026-07' />);
    const input = screen.getByLabelText('Период') as HTMLInputElement;
    expect(input.value).toBe('2026-07');
    expect(input.getAttribute('type')).toBe('month');
    expect(input.getAttribute('name')).toBe('month');
    expect(input.closest('form')?.getAttribute('method')).toBe('get');
    expect(screen.getByRole('button', { name: 'Показать' })).toBeTruthy();
  });
});

function makeStage(overrides: Partial<StageSnapshot> = {}): StageSnapshot {
  return { stageId: 's1', name: 'Новый', color: null, count: 0, estimatedSum: '0.00', ...overrides };
}

function makeCohort(overrides: Partial<CohortStats> = {}): CohortStats {
  return {
    total: 0,
    promoted: 0,
    rejected: 0,
    inWork: 0,
    conversionPct: 0,
    rejectedPct: 0,
    avgDaysToPromote: null,
    estimatedTotal: '0.00',
    promotedEstimated: '0.00',
    ...overrides
  };
}

function makeManagerRow(overrides: Partial<ManagerFunnelRow> = {}): ManagerFunnelRow {
  return { managerId: 'm1', name: 'Иван Менеджеров', assigned: 0, promoted: 0, rejected: 0, conversionPct: 0, ...overrides };
}

describe('FunnelAnalyticsPanel', () => {
  it('renders KPI tiles from cohort stats, with avgDaysToPromote as a number when set', () => {
    const cohort = makeCohort({
      total: 21,
      promoted: 8,
      rejected: 4,
      conversionPct: 40,
      avgDaysToPromote: 3.5
    });
    render(<FunnelAnalyticsPanel snapshot={[]} cohort={cohort} perManager={[]} />);

    expect(screen.getByText('21')).toBeTruthy();
    expect(screen.getByText('8')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('3.5')).toBeTruthy();
  });

  it('renders "—" for avgDaysToPromote when null (no promoted lead has a promotedOrder yet)', () => {
    render(<FunnelAnalyticsPanel snapshot={[]} cohort={makeCohort()} perManager={[]} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('renders per-stage bars sized relative to the max count, with money via fmtMoney', () => {
    const snapshot: StageSnapshot[] = [
      makeStage({ stageId: 's1', name: 'Новый', count: 10, estimatedSum: '100000.00' }),
      makeStage({ stageId: 's2', name: 'Квалификация', count: 5, estimatedSum: '50000.00' })
    ];
    const { container } = render(
      <FunnelAnalyticsPanel snapshot={snapshot} cohort={makeCohort({ total: 15 })} perManager={[]} />
    );

    expect(screen.getByText('Новый')).toBeTruthy();
    expect(screen.getByText('Квалификация')).toBeTruthy();
    expect(container.textContent).toContain(fmtMoney('100000.00'));
    expect(container.textContent).toContain(fmtMoney('50000.00'));

    const bars = container.querySelectorAll('[data-testid="stage-bar"]');
    expect(bars).toHaveLength(2);
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
  });

  it('shows "Открытых лидов нет" when the stage snapshot is empty', () => {
    render(<FunnelAnalyticsPanel snapshot={[]} cohort={makeCohort()} perManager={[]} />);
    expect(screen.getByText('Открытых лидов нет')).toBeTruthy();
  });

  it('shows "Открытых лидов нет" when every stage count is zero', () => {
    const snapshot = [makeStage({ stageId: 's1', count: 0 }), makeStage({ stageId: 's2', count: 0 })];
    render(<FunnelAnalyticsPanel snapshot={snapshot} cohort={makeCohort()} perManager={[]} />);
    expect(screen.getByText('Открытых лидов нет')).toBeTruthy();
  });

  it('shows "Лидов за период нет" and hides the per-manager table when cohort.total is 0', () => {
    render(<FunnelAnalyticsPanel snapshot={[]} cohort={makeCohort({ total: 0 })} perManager={[]} />);
    expect(screen.getByText('Лидов за период нет')).toBeTruthy();
    expect(screen.queryByText('Менеджер')).toBeNull();
  });

  it('renders the per-manager table including a "Без менеджера" row when present', () => {
    const perManager: ManagerFunnelRow[] = [
      makeManagerRow({ managerId: 'm1', name: 'Иван Менеджеров', assigned: 6, promoted: 3, rejected: 1, conversionPct: 50 }),
      makeManagerRow({ managerId: null, name: 'Без менеджера', assigned: 2, promoted: 0, rejected: 0, conversionPct: 0 })
    ];
    render(<FunnelAnalyticsPanel snapshot={[]} cohort={makeCohort({ total: 8 })} perManager={perManager} />);

    expect(screen.getByText('Иван Менеджеров')).toBeTruthy();
    expect(screen.getByText('Без менеджера')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
  });
});

function makePlanRow(overrides: Partial<PlanFactRow> = {}): PlanFactRow {
  return {
    managerId: 'm1',
    name: 'Иван Менеджеров',
    email: 'ivan@example.com',
    target: '100000.00',
    fact: '75000.00',
    completedOrders: 3,
    executionPct: 75,
    ...overrides
  };
}

const TOTALS: PlanFactTotals = { target: '100000.00', fact: '75000.00', executionPct: 75 };

describe('PlanFactTable', () => {
  beforeEach(() => {
    refresh.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
    upsertSalesTargetAction.mockReset();
  });

  it('shows the empty state when there are no rows for the period', () => {
    render(<PlanFactTable year={2026} month={7} rows={[]} totals={{ target: '0.00', fact: '0.00', executionPct: null }} />);
    expect(screen.getByText('Нет данных за выбранный период.')).toBeTruthy();
  });

  it('renders a manager row (with email) and the totals row', () => {
    const row = makePlanRow();
    const { container } = render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    expect(screen.getByText('Иван Менеджеров')).toBeTruthy();
    expect(screen.getByText('ivan@example.com')).toBeTruthy();
    expect(container.textContent).toContain(fmtMoney('75000.00'));
    expect(container.textContent).toContain(fmtMoney('100000.00'));
    expect(screen.getAllByText('75.0%').length).toBeGreaterThan(0);
    expect(screen.getByText('Итого')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders the "Без менеджера" row read-only (no email, no inline form, target dash)', () => {
    const row = makePlanRow({ managerId: null, name: 'Без менеджера', email: '', target: null, executionPct: null, completedOrders: 1 });
    render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    expect(screen.getByText('Без менеджера')).toBeTruthy();
    expect(screen.queryByLabelText('План для Без менеджера')).toBeNull();
    // executionPct null -> "—" (both this row's cell and any others render the dash)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('inline save: enters a new plan amount and calls the action with parsed args, then toasts + refreshes', async () => {
    upsertSalesTargetAction.mockResolvedValue({ ok: true });
    const row = makePlanRow({ target: null });
    render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    const input = screen.getByLabelText('План для Иван Менеджеров') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(upsertSalesTargetAction).toHaveBeenCalledWith({
        managerId: 'm1',
        year: 2026,
        month: 7,
        targetAmount: '50000'
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('План сохранён'));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('inline save: clearing the input submits targetAmount: null (clears the plan)', async () => {
    upsertSalesTargetAction.mockResolvedValue({ ok: true });
    const row = makePlanRow({ target: '100000.00' });
    render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    const input = screen.getByLabelText('План для Иван Менеджеров') as HTMLInputElement;
    expect(input.value).toBe('100000.00');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(upsertSalesTargetAction).toHaveBeenCalledWith({
        managerId: 'm1',
        year: 2026,
        month: 7,
        targetAmount: null
      })
    );
  });

  it('inline save: input without a name attribute → defensive ?? fallback treats it as empty (clears the plan)', async () => {
    upsertSalesTargetAction.mockResolvedValue({ ok: true });
    const row = makePlanRow({ target: '100000.00' });
    render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    const input = screen.getByLabelText('План для Иван Менеджеров') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '30000' } });
    input.removeAttribute('name');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() =>
      expect(upsertSalesTargetAction).toHaveBeenCalledWith({
        managerId: 'm1',
        year: 2026,
        month: 7,
        targetAmount: null
      })
    );
  });

  it('inline save: error path shows an inline alert and does not toast success', async () => {
    upsertSalesTargetAction.mockResolvedValue({ ok: false, error: 'invalid' });
    const row = makePlanRow();
    render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    fireEvent.change(screen.getByLabelText('План для Иван Менеджеров'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Некорректная сумма плана.');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('renders a subtle progress bar for a non-null executionPct, clamped to [0,100]', () => {
    const row = makePlanRow({ executionPct: 140 });
    const { container } = render(<PlanFactTable year={2026} month={7} rows={[row]} totals={TOTALS} />);

    const bar = container.querySelector('[data-testid="execution-bar"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.style.width).toBe('100%');
  });
});
