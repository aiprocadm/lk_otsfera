import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { Button } from '@/components/ui/button';
describe('Button', () => {
  it('renders children and primary brand styling by default', () => {
    const html = renderToString(React.createElement(Button, null, 'Сохранить'));
    expect(html).toContain('Сохранить');
    expect(html).toContain('#F97316');
  });
  it('when loading: shows spinner and is disabled', () => {
    const html = renderToString(React.createElement(Button, { loading: true }, 'Загрузить'));
    expect(html).toContain('animate-spin');
    expect(html).toContain('disabled');
  });
  it('defaults to type=button (not submit)', () => {
    const html = renderToString(React.createElement(Button, null, 'X'));
    expect(html).toContain('type="button"');
  });
  it('respects an explicit type=submit', () => {
    const html = renderToString(React.createElement(Button, { type: 'submit' }, 'X'));
    expect(html).toContain('type="submit"');
  });
});
