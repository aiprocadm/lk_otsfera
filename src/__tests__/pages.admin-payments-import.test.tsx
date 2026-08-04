// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import AdminPaymentsImportPage from '@/app/admin/settings/integrations/1c/payments/page';
import { renderServerComponent } from './helpers/renderServerComponent';

const { requireSettingsSection } = vi.hoisted(() => ({ requireSettingsSection: vi.fn() }));
vi.mock('@/lib/auth/requireSettings', () => ({ requireSettingsSection }));

const { organizationFindMany } = vi.hoisted(() => ({ organizationFindMany: vi.fn() }));
vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findMany: organizationFindMany } },
}));

const { listQueue } = vi.hoisted(() => ({ listQueue: vi.fn() }));
vi.mock('@/lib/services/import/oneCAccountCard', () => ({ listQueue }));

vi.mock('@/components/import/payment-import-form', () => ({
  PaymentImportForm: () => React.createElement('div', { 'data-testid': 'payment-import-form' }),
}));

vi.mock('@/components/import/payment-queue-table', () => ({
  PaymentQueueTable: (props: { rows: unknown[] }) =>
    React.createElement(
      'div',
      { 'data-testid': 'payment-queue-table' },
      JSON.stringify(props.rows)
    ),
}));

const SESSION = { sub: 'admin1', role: 'admin' as const };

describe('AdminPaymentsImportPage', () => {
  beforeEach(() => {
    requireSettingsSection.mockReset();
    organizationFindMany.mockReset();
    listQueue.mockReset();
  });

  it('skips the organization lookup when no queue row has a candidateOrgId', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listQueue.mockResolvedValue([
      {
        id: 'q1',
        externalId: 'ext1',
        paidAt: new Date('2024-01-01'),
        amount: '100.00',
        isRefund: false,
        purpose: 'Оплата',
        counterpartyName: 'ООО Ромашка',
        counterpartyInn: '1234567890',
        accountCandidates: [],
        candidateOrgId: null,
        matchMethod: 'none',
      },
    ]);

    const { container } = await renderServerComponent(AdminPaymentsImportPage());

    expect(requireSettingsSection).toHaveBeenCalled();
    expect(listQueue).toHaveBeenCalledWith(expect.anything(), SESSION);
    expect(organizationFindMany).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Импорт выписки');
    expect(container.textContent).toContain('ext1');
  });

  it('looks up candidate organizations and maps candidateOrgName (found + not-found branches), null accountCandidates fallback', async () => {
    requireSettingsSection.mockResolvedValue(SESSION);
    listQueue.mockResolvedValue([
      {
        id: 'q1',
        externalId: 'ext1',
        paidAt: new Date('2024-01-01'),
        amount: '100.00',
        isRefund: true,
        purpose: 'Возврат',
        counterpartyName: 'ООО Ромашка',
        counterpartyInn: '1234567890',
        accountCandidates: ['a1', 'a2'],
        candidateOrgId: 'org-1',
        matchMethod: 'inn',
      },
      {
        id: 'q2',
        externalId: 'ext2',
        paidAt: new Date('2024-01-02'),
        amount: '50.00',
        isRefund: false,
        purpose: 'Оплата',
        counterpartyName: 'ИП Иванов',
        counterpartyInn: null,
        accountCandidates: null,
        candidateOrgId: 'org-2',
        matchMethod: 'manual',
      },
    ]);
    organizationFindMany.mockResolvedValue([{ id: 'org-1', name: 'Org One' }]);

    const { container } = await renderServerComponent(AdminPaymentsImportPage());

    expect(organizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['org-1', 'org-2'] } } })
    );
    expect(container.textContent).toContain('Org One');
    expect(container.textContent).toContain('ext2');
  });
});
