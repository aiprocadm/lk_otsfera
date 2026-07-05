// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireManagerLeader } = vi.hoisted(() => ({ requireManagerLeader: vi.fn() }));
vi.mock('@/lib/auth/requireRole', () => ({ requireManagerLeader }));

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

const { listCorrectionQueue } = vi.hoisted(() => ({ listCorrectionQueue: vi.fn() }));
vi.mock('@/lib/services/commission/corrections', () => ({ listCorrectionQueue }));

// CorrectionsQueueTable is a 'use client' component that calls useRouter().
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

vi.mock('@/components/commission/corrections-queue-table', () => ({
  CorrectionsQueueTable: (props: { rows: unknown[] }) =>
    React.createElement('div', { 'data-testid': 'corrections-table' }, JSON.stringify(props.rows))
}));

import LeaderCommissionCorrectionsPage from '@/app/leader/commission-corrections/page';

const SESSION = { sub: 'u1', role: 'manager' as const, managerRole: 'leader' as const, companyId: 'c1' };

describe('LeaderCommissionCorrectionsPage', () => {
  beforeEach(() => {
    requireManagerLeader.mockReset();
    listCorrectionQueue.mockReset();
  });

  it('serializes correction rows (Decimal -> string, dates -> ISO) and passes them to the table', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listCorrectionQueue.mockResolvedValue([
      {
        id: 'cr1',
        partner: { name: 'Партнёр' },
        amount: { toString: () => '100.00' },
        commissionAmount: { toString: () => '10.00' },
        rate: { toString: () => '0.10' },
        originalPeriodFrom: new Date('2026-01-01T00:00:00Z'),
        originalPeriodTo: new Date('2026-01-31T00:00:00Z')
      }
    ]);

    const { container } = await renderServerComponent(LeaderCommissionCorrectionsPage());

    expect(requireManagerLeader).toHaveBeenCalled();
    expect(listCorrectionQueue).toHaveBeenCalledWith({}, SESSION);
    expect(container.textContent).toContain('Корректировки комиссии');
    expect(container.textContent).toContain('Партнёр');
    expect(container.textContent).toContain('100.00');
    expect(container.textContent).toContain('2026-01-01T00:00:00.000Z');
  });

  it('falls back to em-dash partner name when partner is null', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listCorrectionQueue.mockResolvedValue([
      {
        id: 'cr2',
        partner: null,
        amount: { toString: () => '5.00' },
        commissionAmount: { toString: () => '0.50' },
        rate: { toString: () => '0.10' },
        originalPeriodFrom: new Date('2026-02-01T00:00:00Z'),
        originalPeriodTo: new Date('2026-02-28T00:00:00Z')
      }
    ]);

    const { container } = await renderServerComponent(LeaderCommissionCorrectionsPage());

    expect(container.textContent).toContain('—');
  });

  it('renders with an empty queue', async () => {
    requireManagerLeader.mockResolvedValue(SESSION);
    listCorrectionQueue.mockResolvedValue([]);

    const { container } = await renderServerComponent(LeaderCommissionCorrectionsPage());

    expect(container.textContent).toContain('Корректировки комиссии');
  });
});
