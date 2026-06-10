import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
describe('form controls', () => {
  it('Input forwards native props and shared focus ring', () => {
    const html = renderToString(React.createElement(Input, { placeholder: 'Имя' }));
    expect(html).toContain('placeholder="Имя"');
    expect(html).toContain('focus:ring-[#F97316]');
  });
  it('Input invalid sets aria-invalid', () => {
    const html = renderToString(React.createElement(Input, { invalid: true }));
    expect(html).toContain('aria-invalid="true"');
  });
  it('Textarea renders a textarea with shared styling', () => {
    const html = renderToString(React.createElement(Textarea, { rows: 3 }));
    expect(html).toContain('<textarea');
    expect(html).toContain('focus:ring-[#F97316]');
  });
  it('Select renders its option children', () => {
    const html = renderToString(
      React.createElement(Select, { value: 'a', onChange: () => {} },
        React.createElement('option', { value: 'a' }, 'A'))
    );
    expect(html).toContain('<select');
    expect(html).toContain('A');
  });
});
