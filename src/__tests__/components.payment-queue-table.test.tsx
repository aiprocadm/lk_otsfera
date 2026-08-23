import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// `У-53`: пакетное создание обновляет список после успеха.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

vi.mock('@/server-actions/payment-import', () => ({
  dismissQueueRowAction: vi.fn(),
  resolveQueueRowAction: vi.fn(),
  searchResolveOrgsAction: vi.fn().mockResolvedValue([]),
  listResolveOrdersAction: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/ui/toast', () => ({ toast: { success: vi.fn() } }));

import { PaymentQueueTable, type QueueRow } from '@/components/import/payment-queue-table';

function row(over: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'r1',
    externalId: '0000-9',
    paidAt: '2026-06-01T00:00:00.000Z',
    amount: '1500.00',
    isRefund: false,
    purpose: 'Оплата',
    counterpartyName: 'ООО Ромашка',
    counterpartyInn: '7701234567',
    accountCandidates: ['СЧ-1'],
    counterpartyKey: 'РОМАШКА',
    candidateOrgId: 'org1',
    candidateOrgName: 'ООО Ромашка',
    candidateOrderId: null,
    matchMethod: 'fuzzy',
    batchCompanyId: 'co-1',
    ...over,
  };
}

describe('PaymentQueueTable', () => {
  it('renders both actions per row, including the new «Привязать»', () => {
    const html = renderToString(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    expect(html).toContain('Привязать');
    expect(html).toContain('Отклонить');
  });

  it('shows the fuzzy-match candidate org as the suggestion', () => {
    const html = renderToString(<PaymentQueueTable rows={[row()]}  total={1} take={50} skip={0} basePath="/x" searchParams={{}} />);
    expect(html).toContain('ООО Ромашка');
  });

  it('renders the empty-queue notice when there are no rows', () => {
    const html = renderToString(<PaymentQueueTable rows={[]}  total={0} take={50} skip={0} basePath="/x" searchParams={{}} />);
    expect(html).toContain('Очередь пуста');
    expect(html).not.toContain('Привязать');
  });
});
