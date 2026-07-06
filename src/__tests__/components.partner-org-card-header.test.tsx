import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgCardHeader } from '@/components/partner/org-card-header';
import type { OrgCard } from '@/lib/services/partner/orgCard';

function makeCard(overrides: Partial<OrgCard> = {}): OrgCard {
  return {
    id: 'o1',
    name: 'ООО Ромашка',
    inn: '7707083893',
    kpp: '770701001',
    legalName: 'Общество с ограниченной ответственностью «Ромашка»',
    assignedManagerUserId: null,
    partnerCommissionRate: null,
    partnerCommissionRateNote: null,
    kpi: { ordersCount: 3, debt: '0.00' },
    ...overrides
  };
}

describe('OrgCardHeader', () => {
  it('renders name, INN/KPP and legal name when present', () => {
    const html = renderToString(React.createElement(OrgCardHeader, { card: makeCard() }));
    expect(html).toContain('ООО Ромашка');
    expect(html).toContain('ИНН <!-- -->7707083893');
    expect(html).toContain('КПП 770701001');
    expect(html).toContain('Общество с ограниченной ответственностью');
  });

  it('falls back to em-dash for missing INN and omits KPP/legalName when absent', () => {
    const html = renderToString(
      React.createElement(OrgCardHeader, { card: makeCard({ inn: null, kpp: null, legalName: null }) })
    );
    expect(html).toContain('ИНН <!-- -->—');
    expect(html).not.toContain('КПП');
  });

  it('shows debt tile with red accent when debt > 0', () => {
    const html = renderToString(
      React.createElement(OrgCardHeader, { card: makeCard({ kpi: { ordersCount: 1, debt: '5000.00' } }) })
    );
    expect(html).toContain('text-red-700');
    expect(html).toContain('bg-red-50');
  });

  it('shows neutral debt tile when debt is 0', () => {
    const html = renderToString(
      React.createElement(OrgCardHeader, { card: makeCard({ kpi: { ordersCount: 0, debt: '0' } }) })
    );
    expect(html).toContain('bg-gray-50');
  });

  it('renders the individual commission rate block with note when set', () => {
    const html = renderToString(
      React.createElement(OrgCardHeader, {
        card: makeCard({ partnerCommissionRate: '0.085', partnerCommissionRateNote: 'VIP-клиент' })
      })
    );
    expect(html).toContain('Индивидуальная ставка комиссии');
    expect(html).toContain('8.50<!-- -->%');
    expect(html).toContain('VIP-клиент');
  });

  it('omits the commission-rate block entirely when partnerCommissionRate is null', () => {
    const html = renderToString(React.createElement(OrgCardHeader, { card: makeCard({ partnerCommissionRate: null }) }));
    expect(html).not.toContain('Индивидуальная ставка комиссии');
  });

  it('renders the rate block without the note span when partnerCommissionRateNote is null', () => {
    const html = renderToString(
      React.createElement(OrgCardHeader, { card: makeCard({ partnerCommissionRate: '0.1', partnerCommissionRateNote: null }) })
    );
    expect(html).toContain('10.00<!-- -->%');
    expect(html).not.toContain('ml-1 text-orange-600');
  });
});
