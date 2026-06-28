import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Spinner } from '@/components/ui/spinner';
describe('Spinner', () => {
  it('renders a spinning, aria-hidden icon', () => {
    const html = renderToString(React.createElement(Spinner));
    expect(html).toContain('animate-spin');
    expect(html).toContain('aria-hidden');
  });
  it('merges a caller-supplied className', () => {
    const html = renderToString(React.createElement(Spinner, { className: 'h-6 w-6' }));
    expect(html).toContain('h-6');
  });
});
