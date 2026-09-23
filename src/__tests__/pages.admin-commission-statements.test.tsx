// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listAdminStatements, listPartnersForFilter } = vi.hoisted(() => ({
  listAdminStatements: vi.fn(),
  listPartnersForFilter: vi.fn(),
}));
vi.mock('@/lib/services/admin/commissionStatements', () => ({
  listAdminStatements,
  listPartnersForFilter,
}));

import AdminCommissionStatementsPage from '@/app/admin/commission-statements/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminCommissionStatementsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listAdminStatements.mockReset();
    listPartnersForFilter.mockReset();
  });

  it('parses status/partnerId/from/to filters and renders rows with same-month period + status badge', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([
      {
        id: 's1',
        partner: { name: 'Партнёр 1' },
        periodFrom: new Date('2024-01-01'),
        periodTo: new Date('2024-01-31'),
        status: 'draft',
        itemCount: 3,
        totalCommissionAmount: '1000',
      },
    ]);
    listPartnersForFilter.mockResolvedValue([{ id: 'p1', name: 'Партнёр 1' }]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({
        searchParams: Promise.resolve({
          status: 'draft',
          partnerId: 'p1',
          from: '2024-01-01',
          to: '2024-01-31',
        }),
      })
    );

    expect(requireAdmin).toHaveBeenCalled();
    expect(listAdminStatements).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ status: 'draft', partnerId: 'p1', take: 100 })
    );
    expect(container.textContent).toContain('Комиссионные отчёты');
    expect(container.textContent).toContain('Партнёр 1');
    expect(container.textContent).toContain('Черновик');
    const link = container.querySelector('a[href="/admin/commission-statements/s1"]');
    expect(link).not.toBeNull();
  });

  it('ignores an invalid status and an invalid "from" date string, renders EmptyState when no rows', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([]);
    listPartnersForFilter.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({
        searchParams: Promise.resolve({ status: 'bogus', from: 'not-a-date' }),
      })
    );

    expect(listAdminStatements).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        status: undefined,
        partnerId: undefined,
        from: undefined,
        to: undefined,
      })
    );
    expect(container.textContent).toContain('не найдены');
  });

  it('renders a cross-month period label and an unknown status badge fallback', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([
      {
        id: 's2',
        partner: { name: 'Партнёр 2' },
        periodFrom: new Date('2024-01-15'),
        periodTo: new Date('2024-02-15'),
        status: 'unknown_status',
        itemCount: 1,
        totalCommissionAmount: 'abc',
      },
    ]);
    listPartnersForFilter.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('unknown_status');
    expect(container.textContent).toContain('—');
  });

  /**
   * Прогон сопровождения №36, группы Б и В спеки
   * `2026-09-23-moscow-time-in-server-code`. Ведомость пишется с московскими
   * границами месяца (`Д-22`): у августовской `periodFrom` — 31.07 21:00 по
   * Гринвичу. Фильтр «Период с 01.08» раньше давал 01.08 00:00 по Гринвичу —
   * и августовскую ведомость не находил.
   */
  it('прогон №36: «Период с/по» — московские сутки; «по» — полночь по Москве после дня (lt)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([]);
    listPartnersForFilter.mockResolvedValue([]);

    await renderServerComponent(
      AdminCommissionStatementsPage({
        searchParams: Promise.resolve({ from: '2026-08-01', to: '2026-08-31' }),
      })
    );

    const [, opts] = listAdminStatements.mock.calls[0] as [unknown, { from: Date; to: Date }];
    expect(opts.from.toISOString()).toBe('2026-07-31T21:00:00.000Z');
    // Сервис сравнивает `periodFrom < to`: сентябрьская ведомость (01.09 00:00
    // МСК) уже за границей, августовская — внутри.
    expect(opts.to.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    const august = new Date('2026-07-31T21:00:00.000Z');
    const september = new Date('2026-08-31T21:00:00.000Z');
    expect(august >= opts.from && august < opts.to).toBe(true);
    expect(september < opts.to).toBe(false);
  });

  it('прогон №36: строка с московскими границами расчёта — «авг 2026», а не «31.07.2026 — 31.08.2026»', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listAdminStatements.mockResolvedValue([
      {
        id: 's3',
        partner: { name: 'Партнёр 3' },
        periodFrom: new Date('2026-07-31T21:00:00.000Z'),
        periodTo: new Date('2026-08-31T20:59:59.999Z'),
        status: 'approved',
        itemCount: 1,
        totalCommissionAmount: '500',
      },
    ]);
    listPartnersForFilter.mockResolvedValue([]);

    const { container } = await renderServerComponent(
      AdminCommissionStatementsPage({ searchParams: Promise.resolve({}) })
    );

    expect(container.textContent).toContain('авг 2026');
    expect(container.textContent).not.toContain('31.07.2026');
  });
});
