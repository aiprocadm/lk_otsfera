import { describe, it, expect, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => React.createElement('a', { href, className }, children),
}));

import { ManagerLeadsFilter } from '@/components/manager/manager-leads-filter';

describe('ManagerLeadsFilter', () => {
  it('default query: "Все" tab is active, "Мои заявки" is inactive', () => {
    const html = renderToString(React.createElement(ManagerLeadsFilter, { query: {} }));
    expect(html).toContain('bg-[#F97316] text-white border-[#F97316]');
    expect(html).toContain('Мои заявки');
    expect(html).not.toContain('✓ Мои заявки');
  });

  it('status=in_review: matching tab is active, others are not', () => {
    const html = renderToString(
      React.createElement(ManagerLeadsFilter, { query: { status: 'in_review' } })
    );
    expect(html).toContain('На рассмотрении');
    // Active tab wraps around in_review link
    const activeTabHref = href_for(html, 'in_review');
    expect(activeTabHref).toContain('bg-[#F97316]');
  });

  it('assignedToMe=1: shows the checked "Мои заявки" state and hidden input', () => {
    const html = renderToString(
      React.createElement(ManagerLeadsFilter, { query: { assignedToMe: '1' } })
    );
    expect(html).toContain('✓ Мои заявки');
    expect(html).toContain('name="assignedToMe"');
    expect(html).toContain('value="1"');
  });

  it('carries status hidden input and default value for search text when set', () => {
    const html = renderToString(
      React.createElement(ManagerLeadsFilter, { query: { status: 'qualified', q: 'ИНН 123' } })
    );
    expect(html).toContain('name="status"');
    expect(html).toContain('value="qualified"');
    expect(html).toContain('value="ИНН 123"');
  });

  it('toggling assignedToMe off (href patch) omits the "1" query param from the link', () => {
    const html = renderToString(
      React.createElement(ManagerLeadsFilter, { query: { assignedToMe: '1' } })
    );
    // The "Мои заявки" link should now point to assignedToMe='' (i.e. omitted from querystring)
    expect(html).toContain('href="/manager/leads"');
  });
});

function href_for(html: string, statusValue: string): string {
  const re = new RegExp(`<a[^>]*href="[^"]*status=${statusValue}[^"]*"[^>]*>`);
  const m = html.match(re);
  return m ? m[0] : '';
}
