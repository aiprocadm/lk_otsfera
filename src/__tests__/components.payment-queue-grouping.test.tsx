// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('@/server-actions/payment-import', () => ({
  dismissQueueRowAction: vi.fn(),
  resolveQueueRowAction: vi.fn(),
  searchResolveOrgsAction: vi.fn().mockResolvedValue([]),
  listResolveOrdersAction: vi.fn().mockResolvedValue([]),
  createOrgFromQueueRowAction: vi.fn(),
  planQueueOrgCreationAction: vi.fn().mockResolvedValue({ ok: true, candidates: [] }),
  createOrgsFromQueueRowsAction: vi.fn(),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PaymentQueueTable } from '@/components/import/payment-queue-table';
import type { QueueRow } from '@/lib/services/import/oneCAccountCard/queue-view';

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'r1',
    externalId: '0000-1',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: '100.00',
    isRefund: false,
    purpose: 'Оплата',
    counterpartyName: 'ООО «Ромашка»',
    counterpartyInn: null,
    counterpartyKey: 'РОМАШКА',
    accountCandidates: [],
    candidateOrgId: null,
    candidateOrgName: null,
    candidateOrderId: null,
    matchMethod: 'none',
    batchCompanyId: 'co-1',
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

// `У-90`: строки одного контрагента (разное написание — один ключ `У-83`)
// сворачиваются в группу: 40 платежей «Ромашки» не должны выглядеть как
// 40 разных задач.
describe('PaymentQueueTable: группировка по контрагенту (У-90)', () => {
  const rows = [
    row({ id: 'r1', counterpartyName: 'ООО «Ромашка»', counterpartyKey: 'РОМАШКА' }),
    row({ id: 'r2', externalId: '0000-2', counterpartyName: 'РОМАШКА, ООО', counterpartyKey: 'РОМАШКА' }),
    row({ id: 'r3', externalId: '0000-3', counterpartyName: 'АО «Вектор»', counterpartyKey: 'ВЕКТОР' }),
  ];

  it('по умолчанию строки показаны плоским списком', () => {
    render(<PaymentQueueTable rows={rows} total={3} take={50} skip={0} basePath="/x" searchParams={{}} />);
    expect(screen.queryByTestId('queue-group-РОМАШКА')).toBeNull();
  });

  it('переключатель собирает строки одного ключа в одну группу со счётчиком', () => {
    render(<PaymentQueueTable rows={rows} total={3} take={50} skip={0} basePath="/x" searchParams={{}} />);
    fireEvent.click(screen.getByRole('button', { name: /Группировать по контрагенту/ }));

    const group = screen.getByTestId('queue-group-РОМАШКА');
    expect(within(group).getByText(/ООО «Ромашка»/)).toBeTruthy();
    expect(within(group).getByText(/строк: 2/)).toBeTruthy();
    expect(screen.getByTestId('queue-group-ВЕКТОР')).toBeTruthy();
  });

  it('строки без названия собираются в группу «Без контрагента»', () => {
    render(
      <PaymentQueueTable
        rows={[row({ id: 'r4', counterpartyName: null, counterpartyKey: null })]}
        total={1}
        take={50}
        skip={0}
        basePath="/x"
        searchParams={{}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Группировать по контрагенту/ }));
    expect(screen.getByText(/Без контрагента/)).toBeTruthy();
  });
});
