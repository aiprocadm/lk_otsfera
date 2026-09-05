// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireAdmin }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCorrectionQueue } = vi.hoisted(() => ({ listCorrectionQueue: vi.fn() }));
vi.mock('@/lib/services/commission/corrections', () => ({ listCorrectionQueue }));

vi.mock('@/components/commission/corrections-queue-table', () => ({
  CorrectionsQueueTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'corrections-table' }, JSON.stringify(props.rows)),
}));

import AdminCommissionCorrectionsPage from '@/app/admin/commission-corrections/page';

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminCommissionCorrectionsPage', () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    listCorrectionQueue.mockReset();
  });

  it('serializes rows (partner name fallback, decimal->string, dates->ISO)', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listCorrectionQueue.mockResolvedValue({
      total: 2,
      rows: [
        {
          id: 'c1',
          partner: { name: 'ООО Партнёр' },
          amount: { toString: () => '100.50' },
          commissionAmount: { toString: () => '10.05' },
          rate: { toString: () => '0.1' },
          originalPeriodFrom: new Date('2024-01-01T00:00:00.000Z'),
          originalPeriodTo: new Date('2024-01-31T00:00:00.000Z'),
        },
        {
          id: 'c2',
          partner: null,
          amount: { toString: () => '50.00' },
          commissionAmount: { toString: () => '5.00' },
          rate: { toString: () => '0.1' },
          originalPeriodFrom: new Date('2024-02-01T00:00:00.000Z'),
          originalPeriodTo: new Date('2024-02-28T00:00:00.000Z'),
        },
      ],
    });

    const { container } = await renderServerComponent(AdminCommissionCorrectionsPage());

    expect(requireAdmin).toHaveBeenCalled();
    expect(listCorrectionQueue).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Корректировки комиссии');
    expect(container.textContent).toContain('ООО Партнёр');
    expect(container.textContent).toContain('—');
    expect(container.textContent).toContain('100.50');
    expect(container.textContent).not.toContain('Показаны первые');
  });

  it('С-6: очередь длиннее окна — «Показаны первые N из M» и совет разобрать эти', async () => {
    requireAdmin.mockResolvedValue(SESSION);
    listCorrectionQueue.mockResolvedValue({ rows: [], total: 350 });

    const { container } = await renderServerComponent(AdminCommissionCorrectionsPage());

    expect(container.textContent).toContain('Показаны первые 0 из 350');
    expect(container.textContent).toContain('Разберите эти — появятся следующие.');
  });
});
