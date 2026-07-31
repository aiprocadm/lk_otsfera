import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import type { LeadStatus } from '@prisma/client';
import { LeadStatusBadge, leadStatusLabel } from '@/components/partner/lead-status-badge';

const ALL_STATUSES: LeadStatus[] = [
  'new',
  'in_review',
  'qualified',
  'promoted_to_order',
  'promoted_to_deal',
  'rejected',
];

describe('LeadStatusBadge', () => {
  it('renders each status with its Russian label and tone class', () => {
    const expectations: Record<LeadStatus, { label: string; tone: string }> = {
      new: { label: 'Новая', tone: 'bg-blue-50' },
      in_review: { label: 'На рассмотрении', tone: 'bg-amber-50' },
      qualified: { label: 'Квалифицирована', tone: 'bg-emerald-50' },
      promoted_to_deal: { label: 'Передана в сделку', tone: 'text-indigo-700' },
      promoted_to_order: { label: 'Стала заказом', tone: 'bg-[#FFF7ED]' },
      rejected: { label: 'Отклонена', tone: 'bg-gray-100' },
    };
    for (const status of ALL_STATUSES) {
      const html = renderToString(React.createElement(LeadStatusBadge, { status }));
      expect(html).toContain(expectations[status].label);
      expect(html).toContain(expectations[status].tone);
    }
  });
});

describe('leadStatusLabel', () => {
  it('returns the matching Russian label for every status', () => {
    expect(leadStatusLabel('new')).toBe('Новая');
    expect(leadStatusLabel('in_review')).toBe('На рассмотрении');
    expect(leadStatusLabel('qualified')).toBe('Квалифицирована');
    expect(leadStatusLabel('promoted_to_order')).toBe('Стала заказом');
    expect(leadStatusLabel('rejected')).toBe('Отклонена');
  });
});
