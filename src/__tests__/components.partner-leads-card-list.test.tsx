import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { LeadsCardList } from '@/components/partner/leads-card-list';
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

describe('LeadsCardList', () => {
  it('renders an empty state with a create-lead link when there are no rows', () => {
    const html = renderToString(React.createElement(LeadsCardList, { rows: [] }));
    expect(html).toContain('Заявок пока нет');
    expect(html).toContain('href="/partner/leads/new"');
    expect(html).toContain('Создать заявку');
  });

  it('renders a card per lead with company, subject, status badge, contact and formatted money/date', () => {
    const html = renderToString(React.createElement(LeadsCardList, { rows: [makeLead()] }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('Обучение электробезопасности');
    expect(html).toContain('Новая');
    expect(html).toContain('Иван Петров');
    expect(html).toContain('150');
    expect(html).toContain('₽');
    expect(html).toContain('href="/partner/leads/l1"');
  });

  it('shows em-dash when estimatedAmount is null', () => {
    const html = renderToString(React.createElement(LeadsCardList, { rows: [makeLead({ estimatedAmount: null })] }));
    expect(html).toContain('—');
  });

  it('renders multiple rows', () => {
    const html = renderToString(
      React.createElement(LeadsCardList, {
        rows: [makeLead({ id: 'l1' }), makeLead({ id: 'l2', clientCompanyName: 'ООО Вторая' })]
      })
    );
    expect(html).toContain('href="/partner/leads/l1"');
    expect(html).toContain('href="/partner/leads/l2"');
    expect(html).toContain('ООО Вторая');
  });
});
