import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Field } from '@/components/ui/field';
describe('Field', () => {
  it('renders a label bound to htmlFor and the control children', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'doc-type', label: 'Тип' },
        React.createElement('select', { id: 'doc-type' }))
    );
    expect(html).toContain('for="doc-type"');
    expect(html).toContain('Тип');
    expect(html).toContain('id="doc-type"');
  });
  it('shows hint when no error', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'f', label: 'L', hint: 'PDF до 20 МБ' },
        React.createElement('input', { id: 'f' }))
    );
    expect(html).toContain('PDF до 20 МБ');
  });
  it('renders an alert error region with a stable id, hiding the hint', () => {
    const html = renderToString(
      React.createElement(Field, { htmlFor: 'f', label: 'L', hint: 'H', error: 'Файл не выбран.' },
        React.createElement('input', { id: 'f' }))
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('id="f-err"');
    expect(html).toContain('Файл не выбран.');
    expect(html).not.toContain('>H<');
  });
});
