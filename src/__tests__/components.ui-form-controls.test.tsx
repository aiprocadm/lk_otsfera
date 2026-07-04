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
  it('Select invalid sets aria-invalid and red border', () => {
    const html = renderToString(React.createElement(Select, { invalid: true }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-red-400');
    expect(html).not.toContain('border-gray-300');
  });
  it('Select valid (default) keeps gray border and omits aria-invalid', () => {
    const html = renderToString(React.createElement(Select, null));
    expect(html).toContain('border-gray-300');
    expect(html).not.toContain('border-red-400');
    expect(html).not.toContain('aria-invalid');
  });
  it('Textarea invalid sets aria-invalid and red border', () => {
    const html = renderToString(React.createElement(Textarea, { invalid: true }));
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('border-red-400');
    expect(html).not.toContain('border-gray-300');
  });
  it('Textarea valid (default) keeps gray border and omits aria-invalid', () => {
    const html = renderToString(React.createElement(Textarea, null));
    expect(html).toContain('border-gray-300');
    expect(html).not.toContain('border-red-400');
    expect(html).not.toContain('aria-invalid');
  });
});
