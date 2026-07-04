import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { LeadsTable } from '@/components/partner/leads-table';
import type { LeadRow } from '@/lib/services/partner/leads';

function makeLead(overrides: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'l1',
    clientCompanyName: 'ООО Ромашка',
    clientInn: '7707083893',
    clientContactName: 'Иван Петров',
    subject: 'Обучение электробезопасности',
    status: 'new',
    estimatedAmount: '150000.00',
    productType: ['training'],
    organizationId: null,
    organizationName: null,
    promotedOrderId: null,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    ...overrides
  };
}

describe('LeadsTable', () => {
  it('renders the empty state with a create-lead link when there are no rows', () => {
    const html = renderToString(React.createElement(LeadsTable, { rows: [] }));
    expect(html).toContain('Заявок пока нет');
    expect(html).toContain('href="/partner/leads/new"');
    expect(html).toContain('Создать первую заявку');
  });

  it('renders a row with company, subject, contact, status badge, money and date', () => {
    const html = renderToString(React.createElement(LeadsTable, { rows: [makeLead()] }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('ИНН <!-- -->7707083893');
    expect(html).toContain('Обучение электробезопасности');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('Новая');
    expect(html).toContain('href="/partner/leads/l1"');
  });

  it('omits the INN sub-line when clientInn is null', () => {
    const html = renderToString(React.createElement(LeadsTable, { rows: [makeLead({ clientInn: null })] }));
    expect(html).not.toContain('ИНН');
  });

  it('renders em-dash for a null estimatedAmount', () => {
    const html = renderToString(React.createElement(LeadsTable, { rows: [makeLead({ estimatedAmount: null })] }));
    expect(html).toContain('—');
  });

  it('renders multiple rows', () => {
    const html = renderToString(
      React.createElement(LeadsTable, { rows: [makeLead({ id: 'l1' }), makeLead({ id: 'l2', clientCompanyName: 'ООО Вторая' })] })
    );
    expect(html).toContain('href="/partner/leads/l1"');
    expect(html).toContain('href="/partner/leads/l2"');
    expect(html).toContain('ООО Вторая');
  });
});
