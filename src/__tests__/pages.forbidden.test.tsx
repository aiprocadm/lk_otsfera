// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import React from 'react';
import ForbiddenPage from '@/app/forbidden/page';
import { renderServerComponent } from './helpers/renderServerComponent';


describe('ForbiddenPage', () => {
  it('renders the 403 message with a link back to /dashboard', async () => {
    const { container } = await renderServerComponent(React.createElement(ForbiddenPage));

    expect(container.textContent).toContain('403');
    expect(container.textContent).toContain('Доступ запрещён');
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/dashboard');
  });
});
