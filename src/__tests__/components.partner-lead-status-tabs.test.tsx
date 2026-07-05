import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { LeadStatusTabs } from '@/components/partner/lead-status-tabs';
import type { LeadStatus } from '@prisma/client';

describe('LeadStatusTabs', () => {
  it('renders the "Все" tab active with the summed total when no status is active', () => {
    const html = renderToString(
      React.createElement(LeadStatusTabs, {
        active: undefined,
        countsByStatus: { new: 2, qualified: 3 }
      })
    );
    expect(html).toContain('Все');
    expect(html).toContain('>5<');
    expect(html).toContain('bg-[#F97316]');
    expect(html).toContain('href="/partner/leads"');
  });

  it('marks the matching status tab active and includes search+status in its href', () => {
    const html = renderToString(
      React.createElement(LeadStatusTabs, {
        active: 'qualified' as LeadStatus,
        countsByStatus: { qualified: 1 },
        search: 'Ромашка'
      })
    );
    expect(html).toContain('Квалифицирована');
    expect(html).toMatch(/href="\/partner\/leads\?search=%D0%A0%D0%BE%D0%BC%D0%B0%D1%88%D0%BA%D0%B0&amp;status=qualified"/);
  });

  it('renders zero count for a status missing from countsByStatus', () => {
    const html = renderToString(
      React.createElement(LeadStatusTabs, { active: undefined, countsByStatus: {} })
    );
    expect(html).toContain('Отклонена');
    // every count renders 0 including "Все"
    expect((html.match(/>0</g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it('inactive chip uses the neutral (non-active) classes', () => {
    const html = renderToString(
      React.createElement(LeadStatusTabs, { active: 'new' as LeadStatus, countsByStatus: { new: 1 } })
    );
    // "Все" chip is inactive here since active='new'
    expect(html).toContain('text-gray-700');
  });
});
