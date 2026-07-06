import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { PartnersFilters } from '@/components/admin/partners-filters';

describe('PartnersFilters', () => {
  it('renders with no active filters: no reset link, defaults empty', () => {
    const html = renderToString(React.createElement(PartnersFilters, {}));
    expect(html).not.toContain('Сбросить');
    expect(html).toContain('Применить');
    expect(html).toContain('Активность');
    expect(html).toContain('Без ставки');
  });

  it('renders reset link when active is set', () => {
    const html = renderToString(React.createElement(PartnersFilters, { active: 'true' }));
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/admin/partners"');
  });

  it('renders reset link when filter=norate is set and checks the checkbox', () => {
    const html = renderToString(React.createElement(PartnersFilters, { filter: 'norate' }));
    expect(html).toContain('Сбросить');
    expect(html).toContain('checked=""');
  });

  it('renders reset link when q is set and pre-fills search value', () => {
    const html = renderToString(React.createElement(PartnersFilters, { q: 'acme' }));
    expect(html).toContain('Сбросить');
    expect(html).toContain('value="acme"');
  });
});
