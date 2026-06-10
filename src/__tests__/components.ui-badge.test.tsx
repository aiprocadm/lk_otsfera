import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Badge } from '@/components/ui/badge';
describe('Badge', () => {
  it('renders children with neutral tone by default', () => {
    const html = renderToString(React.createElement(Badge, null, 'Активен'));
    expect(html).toContain('Активен');
    expect(html).toContain('bg-gray-100');
  });
  it('applies the info tone palette', () => {
    const html = renderToString(React.createElement(Badge, { tone: 'info' }, 'Админ'));
    expect(html).toContain('#FFF7ED');
  });
});
