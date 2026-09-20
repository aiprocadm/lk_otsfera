import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  requireSession,
  notFoundIfDisabled,
  revalidatePath,
  setActiveMetrics,
  upsertKpiTarget,
  copyTargets,
} = vi.hoisted(() => ({
  requireSession: vi.fn(),
  notFoundIfDisabled: vi.fn(),
  revalidatePath: vi.fn(),
  setActiveMetrics: vi.fn(),
  upsertKpiTarget: vi.fn(),
  copyTargets: vi.fn(),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));
vi.mock('@/lib/featureFlags', () => ({ notFoundIfDisabled }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/services/kpi/settings', () => ({
  setActiveMetrics,
  upsertKpiTarget,
  copyTargetsFromPreviousMonth: copyTargets,
}));

import {
  copyKpiTargetsAction,
  setActiveMetricsAction,
  upsertKpiTargetAction,
} from '@/server-actions/kpi';

const SESSION = { sub: 'l1', role: 'leader', companyId: 'c1' };

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue(SESSION);
  setActiveMetrics.mockResolvedValue({ ok: true });
  upsertKpiTarget.mockResolvedValue({ ok: true });
  copyTargets.mockResolvedValue({ ok: true, copied: 2 });
});

describe('действия хаба «Показатели и планы» (У-242)', () => {
  it('набор показателей: все отметки уходят списком, оба кабинета перечитываются', async () => {
    const fd = new FormData();
    fd.append('metric', 'revenue_paid');
    fd.append('metric', 'deals_won');
    expect(await setActiveMetricsAction(fd)).toEqual({ ok: true });
    expect(notFoundIfDisabled).toHaveBeenCalledWith('leader_analytics');
    expect(setActiveMetrics).toHaveBeenCalledWith({}, SESSION, ['revenue_paid', 'deals_won']);
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['/admin/settings/processes/kpi', '/leader/settings/processes/kpi']);
  });

  it('пустое поле плана означает «убрать», а запятая понимается как точка', async () => {
    const fd = new FormData();
    fd.set('metric', 'revenue_paid');
    fd.set('managerId', 'u1');
    fd.set('year', '2026');
    fd.set('month', '9');
    fd.set('amount', '   ');
    await upsertKpiTargetAction(fd);
    expect(upsertKpiTarget.mock.calls[0][2]).toMatchObject({ amount: null, managerId: 'u1' });

    fd.set('amount', '1 000,50'.replace(' ', ''));
    await upsertKpiTargetAction(fd);
    expect(upsertKpiTarget.mock.calls[1][2].amount).toBe('1000.50');
  });

  it('пустой ответственный — это план компании, а не пустая строка', async () => {
    const fd = new FormData();
    fd.set('metric', 'certificates_issued');
    fd.set('managerId', '');
    fd.set('year', '2026');
    fd.set('month', '9');
    fd.set('amount', '40');
    await upsertKpiTargetAction(fd);
    expect(upsertKpiTarget.mock.calls[0][2].managerId).toBeNull();
  });

  it('отказ сервиса возвращается как есть и страницы не перечитываются', async () => {
    setActiveMetrics.mockResolvedValueOnce({ ok: false, error: 'too_many' });
    expect(await setActiveMetricsAction(new FormData())).toEqual({ ok: false, error: 'too_many' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('копирование планов возвращает, сколько строк перенесено', async () => {
    const fd = new FormData();
    fd.set('year', '2026');
    fd.set('month', '9');
    expect(await copyKpiTargetsAction(fd)).toEqual({ ok: true, copied: 2 });
    expect(copyTargets).toHaveBeenCalledWith({}, SESSION, { year: 2026, month: 9 });
  });
  it('форма без полей не роняет действие — пустые значения читаются как пустые', async () => {
    // Ветка `?? ''` у каждого поля: форма, собранная не экраном (например
    // прямым вызовом), приходит без ключей вовсе.
    await upsertKpiTargetAction(new FormData());

    expect(upsertKpiTarget.mock.calls[0][2]).toMatchObject({
      metric: '',
      managerId: null,
      amount: null,
    });
  });

  it('запятая в сумме плана понимается как разделитель дробной части', async () => {
    const fd = new FormData();
    fd.set('metric', 'revenue');
    fd.set('managerId', 'm1');
    fd.set('year', '2026');
    fd.set('month', '9');
    fd.set('amount', '1234,50');

    await upsertKpiTargetAction(fd);

    expect(upsertKpiTarget.mock.calls[0][2].amount).toBe('1234.50');
  });
});
