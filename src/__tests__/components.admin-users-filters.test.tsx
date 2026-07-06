import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';

import { UsersFilters } from '@/components/admin/users-filters';

describe('UsersFilters', () => {
  it('renders with no active filters: no reset link, no hidden inputs', () => {
    const html = renderToString(React.createElement(UsersFilters, {}));
    expect(html).not.toContain('Сбросить');
    expect(html).not.toContain('type="hidden"');
    expect(html).toContain('Все роли');
    expect(html).toContain('Админы');
    expect(html).toContain('Менеджеры');
    expect(html).toContain('Партнёры');
    expect(html).toContain('Организации');
    expect(html).toContain('Студенты');
  });

  it('renders reset link when role is set', () => {
    const html = renderToString(React.createElement(UsersFilters, { role: 'admin' }));
    expect(html).toContain('Сбросить');
    expect(html).toContain('href="/admin/users"');
  });

  it('renders reset link when active is set', () => {
    const html = renderToString(React.createElement(UsersFilters, { active: 'false' }));
    expect(html).toContain('Сбросить');
  });

  it('renders reset link when q is set', () => {
    const html = renderToString(React.createElement(UsersFilters, { q: 'ivan' }));
    expect(html).toContain('Сбросить');
    expect(html).toContain('value="ivan"');
  });

  it('renders hidden partnerId input when provided', () => {
    const html = renderToString(React.createElement(UsersFilters, { partnerId: 'p1' }));
    expect(html).toContain('name="partnerId"');
    expect(html).toContain('value="p1"');
    expect(html).toContain('Сбросить');
  });

  it('renders hidden organizationId input when provided', () => {
    const html = renderToString(React.createElement(UsersFilters, { organizationId: 'o1' }));
    expect(html).toContain('name="organizationId"');
    expect(html).toContain('value="o1"');
    expect(html).toContain('Сбросить');
  });
});
