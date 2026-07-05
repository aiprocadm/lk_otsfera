import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { OrgTabs } from '@/components/partner/org-tabs';

describe('OrgTabs', () => {
  it('renders all tabs including "Настройки" when isAdmin is true, active tab styled distinctly', () => {
    const html = renderToString(React.createElement(OrgTabs, { orgId: 'o1', active: 'employees', isAdmin: true }));
    expect(html).toContain('Сотрудники');
    expect(html).toContain('Документы');
    expect(html).toContain('Комментарии');
    expect(html).toContain('История');
    expect(html).toContain('Настройки');
    expect(html).toContain('text-[#F97316]');
    expect(html).toContain(`href="/partner/portfolio/o1/settings"`);
  });

  it('hides "Настройки" when isAdmin is false', () => {
    const html = renderToString(React.createElement(OrgTabs, { orgId: 'o1', active: 'employees', isAdmin: false }));
    expect(html).not.toContain('Настройки');
  });

  it('builds the documents tab href as a dedicated route (not a query param)', () => {
    const html = renderToString(React.createElement(OrgTabs, { orgId: 'o2', active: 'documents', isAdmin: false }));
    expect(html).toContain(`href="/partner/portfolio/o2/documents"`);
  });

  it('builds query-param hrefs for the remaining tabs', () => {
    const html = renderToString(React.createElement(OrgTabs, { orgId: 'o3', active: 'comments', isAdmin: false }));
    expect(html).toContain(`href="/partner/portfolio/o3?tab=comments"`);
    expect(html).toContain(`href="/partner/portfolio/o3?tab=history"`);
  });

  it('renders inactive tabs with the neutral border/text classes', () => {
    const html = renderToString(React.createElement(OrgTabs, { orgId: 'o1', active: 'history', isAdmin: false }));
    expect(html).toContain('border-transparent');
    expect(html).toContain('text-gray-600');
  });
});
